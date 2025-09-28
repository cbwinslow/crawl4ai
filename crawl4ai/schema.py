from typing import Dict, Any, List, Optional, Union
import json
import re
from dataclasses import dataclass
from crawl4ai.extraction_strategy import JsonCssExtractionStrategy, ExtractionStrategy
from crawl4ai.async_webcrawler import AsyncWebCrawler
from crawl4ai.async_configs import CrawlerRunConfig
import asyncio
from .utils import perform_completion_with_backoff
from .config import DEFAULT_PROVIDER, PROVIDER_MODELS

@dataclass
class GeneratedSchema:
    """Represents a generated extraction schema."""
    name: str
    base_selector: str
    fields: List[Dict[str, Any]]
    description: str
    confidence: float  # Confidence in the generated schema (0.0-1.0)
    validation_errors: List[str]  # Any validation issues found

class SchemaGenerator:
    """
    Automated Schema Generator that creates JsonCssExtractionStrategy schemas from
    natural language descriptions. Makes structured data extraction accessible by
    automatically generating extraction configurations.
    
    Key Features:
    - Natural language schema generation using LLM
    - Automatic CSS selector detection and validation
    - Predefined schema templates for common use cases
    - Integration with existing extraction strategies
    - Schema validation and refinement
    """
    
    def __init__(
        self,
        llm_provider: str = DEFAULT_PROVIDER,
        llm_config: Optional[Dict[str, Any]] = None,
        predefined_templates: Optional[Dict[str, Dict[str, Any]]] = None,
        validation_threshold: float = 0.8,
        **kwargs
    ):
        """
        Initialize the SchemaGenerator.
        
        Args:
            llm_provider: LLM provider for schema generation
            llm_config: Configuration for LLM calls
            predefined_templates: Dictionary of predefined schema templates
            validation_threshold: Minimum confidence for schema validation
            **kwargs: Additional configuration options
        """
        self.llm_provider = llm_provider
        self.llm_config = llm_config or {}
        self.api_key = self.llm_config.get('api_key') or PROVIDER_MODELS.get(llm_provider)
        if not self.api_key:
            raise ValueError(f"API key required for {llm_provider}")
        
        self.validation_threshold = validation_threshold
        
        # Predefined templates for common extraction scenarios
        self.predefined_templates = predefined_templates or {
            "news_article": {
                "name": "News Article Extractor",
                "base_selector": "article.news-item, .post, .article",
                "fields": [
                    {"name": "headline", "selector": "h1, h2.article-title, .title", "type": "text"},
                    {"name": "date", "selector": "time, .publish-date, .date", "type": "text"},
                    {"name": "author", "selector": ".author, .byline", "type": "text"},
                    {"name": "content", "selector": ".content, .body, article p", "type": "text"},
                    {"name": "image", "selector": "img.article-image, .featured-image", "type": "attribute", "attribute": "src"}
                ]
            },
            "product_listing": {
                "name": "E-commerce Product Extractor",
                "base_selector": ".product, .item, [data-product-id]",
                "fields": [
                    {"name": "name", "selector": ".product-title, .name, h3", "type": "text"},
                    {"name": "price", "selector": ".price, .cost", "type": "text"},
                    {"name": "image", "selector": ".product-image", "type": "attribute", "attribute": "src"},
                    {"name": "url", "selector": "a", "type": "attribute", "attribute": "href"},
                    {"name": "rating", "selector": ".rating, .stars", "type": "text"},
                    {"name": "availability", "selector": ".stock, .availability", "type": "text"}
                ]
            },
            "academic_paper": {
                "name": "Academic Paper Extractor",
                "base_selector": ".paper, .entry, article",
                "fields": [
                    {"name": "title", "selector": ".title, h1", "type": "text"},
                    {"name": "authors", "selector": ".authors, .author-list", "type": "text"},
                    {"name": "abstract", "selector": ".abstract", "type": "text"},
                    {"name": "pdf_url", "selector": "a[href$='.pdf']", "type": "attribute", "attribute": "href"},
                    {"name": "citations", "selector": ".citations, .cited-by", "type": "text"},
                    {"name": "publication_date", "selector": ".date, .published", "type": "text"}
                ]
            },
            "job_listing": {
                "name": "Job Listing Extractor",
                "base_selector": ".job, .listing, [data-job-id]",
                "fields": [
                    {"name": "title", "selector": ".job-title, h2", "type": "text"},
                    {"name": "company", "selector": ".company, .employer", "type": "text"},
                    {"name": "location", "selector": ".location", "type": "text"},
                    {"name": "salary", "selector": ".salary, .compensation", "type": "text"},
                    {"name": "description", "selector": ".description", "type": "text"},
                    {"name": "apply_url", "selector": "a.apply-button", "type": "attribute", "attribute": "href"}
                ]
            }
        }
        
        # Common CSS selectors for different element types
        self.common_selectors = {
            "text": ["h1", "h2", "h3", "h4", "h5", "h6", ".title", ".name", ".headline", "p", ".content", ".body"],
            "date": ["time", ".date", ".published", ".timestamp", "[datetime]"],
            "image": ["img", ".image", ".photo", ".avatar"],
            "link": ["a", ".link", ".url"],
            "price": [".price", ".cost", ".amount", "[data-price]"],
            "author": [".author", ".byline", ".contributor"],
            "rating": [".rating", ".stars", ".score"],
            "button": ["button", ".btn", ".button", "input[type='submit']"]
        }
    
    async def generate_from_description(
        self,
        url: str,
        description: str,
        template: Optional[str] = None,
        validate: bool = True,
        crawl_first: bool = True,
        crawler_config: Optional[Dict[str, Any]] = None
    ) -> GeneratedSchema:
        """
        Generate extraction schema from natural language description.
        
        Args:
            url: Target URL for schema generation
            description: Natural language description of what to extract
            template: Optional predefined template name to use as base
            validate: Whether to validate the generated schema
            crawl_first: Whether to crawl the page first for better context
            crawler_config: Configuration for crawling
            
        Returns:
            GeneratedSchema with the created extraction configuration
        """
        if not description.strip():
            raise ValueError("Description cannot be empty")
        
        # Step 1: Optionally crawl the page for context
        page_context = ""
        if crawl_first:
            page_context = await self._get_page_context(url, crawler_config)
        
        # Step 2: Use predefined template if specified
        base_schema = None
        if template and template in self.predefined_templates:
            base_schema = self.predefined_templates[template]
            print(f"Using template: {template}")
        
        # Step 3: Generate schema using LLM
        schema_prompt = self._build_schema_prompt(description, page_context, base_schema)
        llm_response = await self._call_llm(schema_prompt, response_format="json")
        
        if "error" in llm_response:
            raise ValueError(f"Schema generation failed: {llm_response['error']}")
        
        try:
            # Parse generated schema
            generated_data = llm_response
            if isinstance(llm_response, str):
                generated_data = json.loads(llm_response)
            
            schema = self._parse_generated_schema(generated_data, url)
            confidence = generated_data.get("confidence", 0.5)
            
            # Step 4: Validate schema if requested
            if validate:
                validation_result = await self._validate_schema(schema, url, crawler_config)
                schema.validation_errors = validation_result.get("errors", [])
                if validation_result.get("confidence", 1.0) < self.validation_threshold:
                    # Refine schema if validation fails
                    schema = await self._refine_schema(schema, description, validation_result, url, crawler_config)
            
            return GeneratedSchema(
                name=schema.get("name", "Generated Schema"),
                base_selector=schema.get("baseSelector", ""),
                fields=schema.get("fields", []),
                description=description,
                confidence=confidence,
                validation_errors=schema.get("validation_errors", [])
            )
            
        except Exception as e:
            raise ValueError(f"Failed to process generated schema: {str(e)}")
    
    def _build_schema_prompt(
        self,
        description: str,
        page_context: str,
        base_schema: Optional[Dict[str, Any]] = None
    ) -> str:
        """Build the LLM prompt for schema generation."""
        base_schema_example = ""
        if base_schema:
            base_schema_example = f"""
Use this base schema as a starting point and modify it according to the description:
{json.dumps(base_schema, indent=2)}
            """
        
        prompt = f"""
You are an expert web scraping schema generator. Create a JsonCssExtractionStrategy schema for extracting structured data from web pages.

Description: {description}

Page context (if available): {page_context[:1000]}...

{base_schema_example}

Generate a JSON schema with:
- "name": Descriptive name for the extraction strategy
- "baseSelector": CSS selector for the main container (or "body" if page-wide)
- "fields": Array of field definitions with:
  * "name": Field name (camelCase or snake_case)
  * "selector": CSS selector for the element
  * "type": "text", "attribute", "regex", or "html"
  * "attribute": (if type="attribute") which attribute to extract
  * "regex": (if type="regex") regex pattern for extraction
  * "multiple": boolean - extract multiple values or single
  * "description": brief description of what this field extracts

Rules:
1. Use specific, reliable CSS selectors
2. Prefer classes over tags when possible
3. Use attribute selectors for unique identification
4. For lists/repeating items, use plural field names
5. Include error handling selectors as fallbacks
6. Ensure selectors are valid CSS (no XPath)

Example output format:
{{
  "name": "News Article Extractor",
  "baseSelector": "article.news-item",
  "fields": [
    {{
      "name": "headline",
      "selector": "h2.article-title",
      "type": "text",
      "multiple": false,
      "description": "Article headline"
    }},
    {{
      "name": "images",
      "selector": "img.article-image",
      "type": "attribute",
      "attribute": "src",
      "multiple": true,
      "description": "Article images"
    }}
  ],
  "confidence": 0.95
}}

Return ONLY valid JSON. Include a confidence score (0.0-1.0) for how reliable you think the schema is.
        """
        
        return prompt
    
    def _parse_generated_schema(self, generated_data: Dict[str, Any], url: str) -> Dict[str, Any]:
        """Parse and validate the generated schema data."""
        schema = {
            "name": generated_data.get("name", "Generated Schema"),
            "baseSelector": generated_data.get("baseSelector", "body"),
            "fields": generated_data.get("fields", []),
            "url": url,
            "validation_errors": []
        }
        
        # Validate and clean fields
        cleaned_fields = []
        for field in schema["fields"]:
            if not isinstance(field, dict):
                continue
            
            cleaned_field = {
                "name": field.get("name", "").strip(),
                "selector": field.get("selector", "").strip(),
                "type": field.get("type", "text").lower(),
                "multiple": field.get("multiple", False),
                "description": field.get("description", "").strip()
            }
            
            # Handle attribute extraction
            if cleaned_field["type"] == "attribute":
                cleaned_field["attribute"] = field.get("attribute", "src")
            
            # Handle regex extraction
            if cleaned_field["type"] == "regex":
                cleaned_field["regex"] = field.get("regex", "")
            
            # Validate required fields
            if not cleaned_field["name"] or not cleaned_field["selector"]:
                schema["validation_errors"].append(f"Invalid field: {cleaned_field['name']}")
                continue
            
            cleaned_fields.append(cleaned_field)
        
        schema["fields"] = cleaned_fields
        
        # Basic selector validation
        invalid_selectors = []
        for field in schema["fields"]:
            if not self._is_valid_css_selector(field["selector"]):
                invalid_selectors.append(field["name"])
        
        if invalid_selectors:
            schema["validation_errors"].extend(
                [f"Invalid CSS selector for {name}" for name in invalid_selectors]
            )
        
        return schema
    
    def _is_valid_css_selector(self, selector: str) -> bool:
        """Basic CSS selector validation."""
        if not selector:
            return False
        
        # Common invalid patterns
        invalid_patterns = [
            r'\[.*?\]',  # Unclosed attribute selectors
            r':[^:]*$',  # Unclosed pseudo-classes
            r'\s+$',     # Trailing whitespace
            r'^,',       # Leading comma
            r',$',       # Trailing comma
        ]
        
        for pattern in invalid_patterns:
            if re.search(pattern, selector):
                return False
        
        # Basic syntax check
        try:
            # This is a simple check - full validation would require a CSS parser
            if '..' in selector or '/*' in selector or '*/' in selector:
                return False
            return True
        except:
            return False
    
    async def _get_page_context(
        self, 
        url: str, 
        crawler_config: Optional[Dict[str, Any]] = None
    ) -> str:
        """Get page context by crawling with minimal extraction."""
        try:
            async with AsyncWebCrawler() as crawler:
                config = CrawlerRunConfig(
                    cache_mode="bypass",
                    screenshot=False,
                    pdf=False,
                    extraction_strategy=None,  # No extraction, just raw content
                    **(crawler_config or {})
                )
                
                result = await crawler.arun(url=url, config=config)
                
                if result.success and result.markdown:
                    # Return a preview of the content for context
                    return result.markdown[:2000]  # First 2000 chars
                else:
                    return f"Failed to crawl {url}: {result.error_message}"
                    
        except Exception as e:
            return f"Error getting page context: {str(e)}"
    
    async def _validate_schema(
        self,
        schema: Dict[str, Any],
        url: str,
        crawler_config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Validate the generated schema by testing it on the target page."""
        validation_results = {
            "valid_fields": 0,
            "total_fields": len(schema["fields"]),
            "confidence": 1.0,
            "errors": [],
            "sample_data": {}
        }
        
        try:
            async with AsyncWebCrawler() as crawler:
                config = CrawlerRunConfig(
                    cache_mode="bypass",
                    **(crawler_config or {})
                )
                
                # Crawl the page
                result = await crawler.arun(url=url, config=config)
                
                if not result.success or not result.html:
                    validation_results["errors"].append("Failed to crawl page for validation")
                    validation_results["confidence"] = 0.3
                    return validation_results
                
                # Test each field
                from crawl4ai.extraction_strategy import JsonCssExtractionStrategy
                
                test_strategy = JsonCssExtractionStrategy(
                    name=schema["name"],
                    base_selector=schema["baseSelector"],
                    fields=schema["fields"]
                )
                
                extracted = test_strategy.run(url, [result.html])
                
                # Analyze extraction results
                for field in schema["fields"]:
                    field_name = field["name"]
                    extracted_values = extracted.get(field_name, [])
                    
                    if isinstance(extracted_values, list) and len(extracted_values) > 0:
                        # Check if values look reasonable
                        sample_value = extracted_values[0] if extracted_values else ""
                        
                        if isinstance(sample_value, str) and len(sample_value.strip()) > 3:
                            validation_results["valid_fields"] += 1
                            validation_results["sample_data"][field_name] = sample_value[:100]
                        else:
                            validation_results["errors"].append(f"Field '{field_name}' extracted empty or invalid data")
                    else:
                        validation_results["errors"].append(f"Field '{field_name}' found no matching elements")
                
                # Calculate confidence
                success_rate = validation_results["valid_fields"] / validation_results["total_fields"]
                validation_results["confidence"] = max(0.1, min(1.0, success_rate * 0.8 + 0.2))  # Bias towards acceptance
                
                return validation_results
                
        except Exception as e:
            validation_results["errors"].append(f"Validation error: {str(e)}")
            validation_results["confidence"] = 0.2
            return validation_results
    
    async def _refine_schema(
        self,
        schema: Dict[str, Any],
        description: str,
        validation_result: Dict[str, Any],
        url: str,
        crawler_config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Refine a schema based on validation feedback."""
        errors = validation_result.get("errors", [])
        if not errors:
            return schema
        
        refinement_prompt = f"""
The following schema needs refinement based on validation results:

Original Schema:
{json.dumps(schema, indent=2)}

Validation Errors:
{chr(10).join(errors)}

Original Description: {description}

Refine the schema by:
1. Fixing invalid CSS selectors
2. Adding fallback selectors for missing fields
3. Adjusting baseSelector if needed
4. Making selectors more specific or general as appropriate
5. Ensuring all fields have valid extraction types

Return the refined schema in the same JSON format. Focus on fixing the specific validation errors.
        """
        
        llm_response = await self._call_llm(refinement_prompt, response_format="json")
        
        if "error" not in llm_response:
            try:
                refined_data = llm_response
                if isinstance(llm_response, str):
                    refined_data = json.loads(llm_response)
                
                refined_schema = self._parse_generated_schema(refined_data, url)
                refined_schema["refinement_count"] = getattr(schema, "refinement_count", 0) + 1
                return refined_schema
            except Exception:
                pass
        
        # Fallback: add fallback selectors to original schema
        for field in schema["fields"]:
            if "fallback_selectors" not in field:
                field["fallback_selectors"] = self._generate_fallback_selectors(field)
        
        schema["refinement_count"] = getattr(schema, "refinement_count", 0) + 1
        return schema
    
    def _generate_fallback_selectors(self, field: Dict[str, Any]) -> List[str]:
        """Generate fallback CSS selectors for a field."""
        field_type = field.get("type", "text")
        base_selector = field.get("selector", "")
        
        if field_type not in self.common_selectors:
            return []
        
        # Generate fallbacks based on common patterns
        fallbacks = []
        
        # Tag-only fallback
        tag_match = re.search(r'^([a-zA-Z0-9]+)', base_selector)
        if tag_match:
            fallbacks.append(tag_match.group(1))
        
        # Class-based fallbacks
        class_match = re.search(r'\.([a-zA-Z0-9_-]+)', base_selector)
        if class_match:
            fallbacks.append(f".{class_match.group(1)}")
            fallbacks.append(f"[{class_match.group(1)}]")
        
        # Attribute fallbacks for specific types
        if field_type == "image":
            fallbacks.extend(["img", "[src]", ".img", ".image"])
        elif field_type == "link":
            fallbacks.extend(["a", "[href]", ".link"])
        elif field_type == "price":
            fallbacks.extend([".price", "[data-price]", ".cost"])
        
        # Add common selectors for this type
        fallbacks.extend(self.common_selectors.get(field_type, []))
        
        return list(set(fallbacks))  # Remove duplicates
    
    def create_extraction_strategy(self, generated_schema: GeneratedSchema) -> ExtractionStrategy:
        """
        Create an ExtractionStrategy from a GeneratedSchema.
        
        Args:
            generated_schema: The generated schema to convert
            
        Returns:
            JsonCssExtractionStrategy instance
        """
        if generated_schema.validation_errors:
            print(f"Warning: Schema has {len(generated_schema.validation_errors)} validation issues")
        
        return JsonCssExtractionStrategy(
            name=generated_schema.name,
            base_selector=generated_schema.base_selector,
            fields=generated_schema.fields
        )
    
    async def generate_and_test(
        self,
        url: str,
        description: str,
        template: Optional[str] = None,
        max_iterations: int = 2,
        **kwargs
    ) -> Tuple[GeneratedSchema, Dict[str, Any]]:
        """
        Generate schema and test it iteratively.
        
        Args:
            url: Target URL
            description: Extraction description
            template: Base template to use
            max_iterations: Maximum refinement iterations
            **kwargs: Additional parameters
            
        Returns:
            Tuple of (final_schema, test_results)
        """
        schema = await self.generate_from_description(
            url=url,
            description=description,
            template=template,
            crawl_first=True,
            **kwargs
        )
        
        test_results = {}
        current_schema = schema
        
        for iteration in range(max_iterations):
            print(f"Testing schema iteration {iteration + 1}/{max_iterations}")
            
            # Test the current schema
            strategy = self.create_extraction_strategy(current_schema)
            test_config = CrawlerRunConfig(
                extraction_strategy=strategy,
                **kwargs.get("crawler_config", {})
            )
            
            async with AsyncWebCrawler() as crawler:
                result = await crawler.arun(url=url, config=test_config)
                
                test_results[iteration] = {
                    "schema": current_schema,
                    "extraction_result": result.extracted_content,
                    "success": result.success,
                    "validation_errors": current_schema.validation_errors
                }
            
            # Check if we need refinement
            if (result.success and result.extracted_content and 
                len(json.loads(result.extracted_content or "[]")) > 0 and
                len(current_schema.validation_errors) == 0):
                print("Schema validation successful!")
                break
            
            # Refine if needed
            validation_result = {
                "errors": current_schema.validation_errors,
                "confidence": 0.5 if current_schema.validation_errors else 1.0
            }
            
            current_schema = await self._refine_schema(
                current_schema,
                description,
                validation_result,
                url,
                **kwargs
            )
        
        return current_schema, test_results

# Example usage and integration
async def schema_generation_example():
    """Example demonstrating SchemaGenerator usage."""
    generator = SchemaGenerator()
    
    # Example 1: Generate from description
    print("=== Basic Schema Generation ===")
    schema = await generator.generate_from_description(
        url="https://example-news-site.com",
        description="For each news article on the page, I need the headline, publication date, author, and main image"
    )
    
    print(f"Generated Schema: {schema.name}")
    print(f"Base Selector: {schema.base_selector}")
    print(f"Fields: {len(schema.fields)}")
    for field in schema.fields:
        print(f"  - {field['name']}: {field['selector']} ({field['type']})")
    
    if schema.validation_errors:
        print(f"Validation Issues: {schema.validation_errors}")
    
    # Example 2: Using predefined template
    print("\n=== Template-Based Generation ===")
    template_schema = await generator.generate_from_description(
        url="https://example-store.com/products",
        description="Extract product names, prices, and images from the product listing",
        template="product_listing"
    )
    
    print(f"Template Schema Fields: {len(template_schema.fields)}")
    
    # Example 3: Generate and test with iteration
    print("\n=== Generate and Test ===")
    final_schema, test_results = await generator.generate_and_test(
        url="https://example-news-site.com",
        description="Extract article title, date, author, and content summary",
        max_iterations=2
    )
    
    print(f"Final Schema Confidence: {final_schema.confidence:.2f}")
    print(f"Test Results: {len(test_results)} iterations")
    
    # Create extraction strategy
    strategy = generator.create_extraction_strategy(final_schema)
    print(f"Created extraction strategy: {strategy.name}")
    
    return schema, template_schema, final_schema, test_results