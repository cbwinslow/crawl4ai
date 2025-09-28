from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass
import json
from crawl4ai.extraction_strategy import JsonCssExtractionStrategy, ExtractionStrategy
from crawl4ai.models import CrawlResult
from crawl4ai.async_webcrawler import AsyncWebCrawler
from crawl4ai.async_configs import CrawlerRunConfig
import asyncio
import re
from urllib.parse import urlparse

@dataclass
class ExtractionResult:
    """Result from domain-specific extraction."""
    data: List[Dict[str, Any]]
    confidence: float  # 0.0-1.0 confidence in extraction quality
    matched_site_type: str  # e.g., "arxiv", "amazon"
    warnings: List[str]  # Any extraction warnings

class BaseDomainExtractor:
    """
    Base class for domain-specific extractors.
    
    Provides common functionality for specialized extraction strategies.
    """
    
    def __init__(self, site_type: str, default_fields: List[Dict[str, Any]] = None):
        """
        Initialize the base extractor.
        
        Args:
            site_type: Type of site (e.g., "academic", "ecommerce")
            default_fields: Default extraction fields
        """
        self.site_type = site_type
        self.default_fields = default_fields or []
        self.supported_sites = set()
        self._strategies = {}
    
    def detect_site_type(self, url: str) -> Optional[str]:
        """
        Detect specific site type from URL.
        
        Args:
            url: The URL to analyze
            
        Returns:
            Specific site type (e.g., "arxiv", "amazon") or None
        """
        parsed = urlparse(url.lower())
        domain = parsed.netloc
        
        # Site-specific detection
        if "arxiv.org" in domain:
            return "arxiv"
        elif "pubmed.ncbi.nlm.nih.gov" in domain or "ncbi.nlm.nih.gov" in domain:
            return "pubmed"
        elif any(site in domain for site in ["amazon.com", "amazon.co", "ebay.com"]):
            return "ecommerce_general"
        elif any(site in domain for site in ["walmart.com", "target.com"]):
            return "ecommerce_retail"
        elif "scholar.google.com" in domain:
            return "google_scholar"
        
        # Fallback to general type
        return self.site_type
    
    def get_strategy(self, site_type: str) -> Optional[JsonCssExtractionStrategy]:
        """
        Get extraction strategy for specific site type.
        
        Args:
            site_type: Detected site type
            
        Returns:
            Extraction strategy or None if not supported
        """
        if site_type in self._strategies:
            return self._strategies[site_type]
        
        # Create strategy based on site type
        fields = self._get_fields_for_site(site_type)
        if fields:
            strategy = JsonCssExtractionStrategy(
                name=f"{self.site_type.capitalize()} {site_type} Extractor",
                base_selector=self._get_base_selector(site_type),
                fields=fields
            )
            self._strategies[site_type] = strategy
            return strategy
        
        return None
    
    def _get_fields_for_site(self, site_type: str) -> List[Dict[str, Any]]:
        """Get extraction fields for specific site type."""
        # This should be overridden by subclasses
        return self.default_fields
    
    def _get_base_selector(self, site_type: str) -> str:
        """Get base selector for specific site type."""
        # This should be overridden by subclasses
        return "body"

class AcademicExtractor(BaseDomainExtractor):
    """
    Specialized extractor for academic websites and research papers.
    
    Supports:
    - arXiv papers
    - PubMed articles
    - Google Scholar results
    - General academic sites
    """
    
    def __init__(self):
        super().__init__(
            site_type="academic",
            default_fields=[
                {"name": "title", "selector": "h1, .title, [itemprop='name']", "type": "text"},
                {"name": "authors", "selector": ".authors, .author-list, [itemprop='author']", "type": "text", "multiple": True},
                {"name": "abstract", "selector": ".abstract, [itemprop='description']", "type": "text"},
                {"name": "publication_date", "selector": "time, .date, [itemprop='datePublished']", "type": "text"},
                {"name": "pdf_url", "selector": "a[href$='.pdf'], .pdf-link", "type": "attribute", "attribute": "href"},
                {"name": "doi", "selector": "[href*='doi.org'], .doi", "type": "attribute", "attribute": "href"},
                {"name": "citations", "selector": ".citations, .cited-by", "type": "text"},
                {"name": "journal", "selector": ".journal, .source", "type": "text"}
            ]
        )
        
        self.supported_sites = {"arxiv", "pubmed", "google_scholar", "academic_general"}
    
    def _get_fields_for_site(self, site_type: str) -> List[Dict[str, Any]]:
        """Get specialized fields for academic site types."""
        base_fields = super()._get_fields_for_site(site_type)
        
        if site_type == "arxiv":
            return base_fields + [
                {"name": "arxiv_id", "selector": ".arxiv-id, [href*='abs/']", "type": "regex", "regex": r"arXiv:(\d+\.\d+)"},
                {"name": "subjects", "selector": ".subjects, .categories", "type": "text"},
                {"name": "comments", "selector": ".comments", "type": "text"},
                {"name": "endorsements", "selector": ".endorsements", "type": "text"}
            ]
        
        elif site_type == "pubmed":
            return base_fields + [
                {"name": "pmid", "selector": "[href*='pubmed/']", "type": "regex", "regex": r"PMID:\s*(\d+)"},
                {"name": "mesh_terms", "selector": ".mesh-terms", "type": "text", "multiple": True},
                {"name": "journal_abbr", "selector": ".journal-abbr", "type": "text"},
                {"name": "volume", "selector": ".volume", "type": "text"},
                {"name": "pages", "selector": ".pages", "type": "text"}
            ]
        
        elif site_type == "google_scholar":
            return base_fields + [
                {"name": "scholar_id", "selector": "[data-cid]", "type": "attribute", "attribute": "data-cid"},
                {"name": "cited_by_count", "selector": ".citedby", "type": "text"},
                {"name": "version_count", "selector": ".all-versions", "type": "text"},
                {"name": "profile", "selector": ".author a", "type": "text", "multiple": True}
            ]
        
        return base_fields
    
    def _get_base_selector(self, site_type: str) -> str:
        """Get base selector for academic site types."""
        selectors = {
            "arxiv": ".arxiv-paper, .paper-entry, article",
            "pubmed": ".pubmed-article, .rslt",  
            "google_scholar": ".gs_rt, .gsc_a_tr",
            "academic_general": ".paper, .article, .entry, [itemtype*='ScholarlyArticle']"
        }
        return selectors.get(site_type, "body")
    
    async def extract_papers(
        self,
        url: str,
        site_type: Optional[str] = None,
        crawler_config: Optional[Dict[str, Any]] = None,
        max_results: int = 10
    ) -> ExtractionResult:
        """
        Extract academic papers from a URL.
        
        Args:
            url: URL to extract from
            site_type: Specific site type (auto-detected if None)
            crawler_config: Crawler configuration
            max_results: Maximum number of papers to extract
            
        Returns:
            ExtractionResult with extracted papers
        """
        if site_type is None:
            site_type = self.detect_site_type(url)
        
        if not site_type:
            site_type = "academic_general"
        
        strategy = self.get_strategy(site_type)
        if not strategy:
            raise ValueError(f"No extraction strategy for site type: {site_type}")
        
        config = CrawlerRunConfig(
            extraction_strategy=strategy,
            **(crawler_config or {})
        )
        
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=url, config=config)
            
            if not result.success or not result.extracted_content:
                return ExtractionResult([], 0.0, site_type, ["No content extracted"])
            
            try:
                extracted_data = json.loads(result.extracted_content)
                if isinstance(extracted_data, list):
                    data = extracted_data[:max_results]
                else:
                    data = [extracted_data] if extracted_data else []
                
                # Calculate confidence based on data quality
                confidence = self._calculate_academic_confidence(data)
                
                return ExtractionResult(
                    data=data,
                    confidence=confidence,
                    matched_site_type=site_type,
                    warnings=[]
                )
                
            except json.JSONDecodeError as e:
                return ExtractionResult([], 0.0, site_type, [f"JSON parsing error: {str(e)}"])
    
    def _calculate_academic_confidence(self, data: List[Dict[str, Any]]) -> float:
        """Calculate confidence score for academic extraction."""
        if not data:
            return 0.0
        
        total_fields = len(self.default_fields)
        filled_fields = 0
        
        for item in data:
            for field in self.default_fields:
                field_name = field["name"]
                if item.get(field_name) and str(item[field_name]).strip():
                    filled_fields += 1
        
        avg_filled = filled_fields / (len(data) * total_fields) if data else 0
        return min(1.0, avg_filled * 1.2)  # Slight boost for partial matches

class EcommerceExtractor(BaseDomainExtractor):
    """
    Specialized extractor for e-commerce websites and product listings.
    
    Supports:
    - General product listings
    - Amazon product pages
    - Review/rating extraction
    - Price and availability tracking
    """
    
    def __init__(self):
        super().__init__(
            site_type="ecommerce",
            default_fields=[
                {"name": "product_name", "selector": ".product-title, .name, h1", "type": "text"},
                {"name": "price", "selector": ".price, .cost, [itemprop='price']", "type": "text"},
                {"name": "currency", "selector": ".currency, [itemprop='priceCurrency']", "type": "text"},
                {"name": "image", "selector": ".product-image, [itemprop='image']", "type": "attribute", "attribute": "src"},
                {"name": "url", "selector": "a.product-link", "type": "attribute", "attribute": "href"},
                {"name": "availability", "selector": ".stock, .availability, [itemprop='availability']", "type": "text"},
                {"name": "rating", "selector": ".rating, .stars, [itemprop='ratingValue']", "type": "text"},
                {"name": "reviews_count", "selector": ".reviews-count, [itemprop='reviewCount']", "type": "text"},
                {"name": "description", "selector": ".description, .product-details", "type": "text"},
                {"name": "brand", "selector": ".brand, [itemprop='brand']", "type": "text"},
                {"name": "category", "selector": ".category, .breadcrumbs", "type": "text"},
                {"name": "sku", "selector": ".sku, [itemprop='sku']", "type": "text"}
            ]
        )
        
        self.supported_sites = {"amazon", "ebay", "walmart", "ecommerce_general", "ecommerce_retail"}
    
    def _get_fields_for_site(self, site_type: str) -> List[Dict[str, Any]]:
        """Get specialized fields for e-commerce site types."""
        base_fields = super()._get_fields_for_site(site_type)
        
        if site_type == "amazon":
            return base_fields + [
                {"name": "asin", "selector": "[data-asin], .asin", "type": "attribute", "attribute": "data-asin"},
                {"name": "prime_eligible", "selector": ".prime-logo", "type": "exists"},
                {"name": "buy_box_winner", "selector": ".buy-box", "type": "exists"},
                {"name": "customer_reviews", "selector": ".cr_avgstars", "type": "text"},
                {"name": "also_bought", "selector": ".similar-product", "type": "text", "multiple": True}
            ]
        
        elif site_type == "ebay":
            return base_fields + [
                {"name": "item_id", "selector": "[data-itemid]", "type": "attribute", "attribute": "data-itemid"},
                {"name": "bidding_status", "selector": ".bid-status", "type": "text"},
                {"name": "watch_count", "selector": ".watch-count", "type": "text"},
                {"name": "shipping_cost", "selector": ".shipping-cost", "type": "text"},
                {"name": "returns_policy", "selector": ".returns-info", "type": "text"}
            ]
        
        elif site_type in {"walmart", "ecommerce_retail"}:
            return base_fields + [
                {"name": "upc", "selector": ".upc, [itemprop='gtin']", "type": "text"},
                {"name": "in_stock", "selector": ".in-stock", "type": "exists"},
                {"name": "free_shipping", "selector": ".free-shipping", "type": "exists"},
                {"name": "warranty_info", "selector": ".warranty", "type": "text"},
                {"name": "store_locator", "selector": ".store-link", "type": "attribute", "attribute": "href"}
            ]
        
        return base_fields
    
    def _get_base_selector(self, site_type: str) -> str:
        """Get base selector for e-commerce site types."""
        selectors = {
            "amazon": ".s-result-item, .product, [data-asin]",
            "ebay": ".s-item, .item, [data-itemid]", 
            "walmart": ".product-tile, .item, [data-automation-id='product-tile']",
            "ecommerce_general": ".product, .item, [data-product-id], [itemtype='http://schema.org/Product']",
            "ecommerce_retail": ".product-card, .item-card, .tile"
        }
        return selectors.get(site_type, ".product, .item")
    
    async def extract_products(
        self,
        url: str,
        site_type: Optional[str] = None,
        crawler_config: Optional[Dict[str, Any]] = None,
        max_results: int = 20,
        extract_reviews: bool = False
    ) -> ExtractionResult:
        """
        Extract products from an e-commerce URL.
        
        Args:
            url: URL to extract from
            site_type: Specific site type (auto-detected if None)
            crawler_config: Crawler configuration
            max_results: Maximum number of products to extract
            extract_reviews: Whether to extract review data
            
        Returns:
            ExtractionResult with extracted products
        """
        if site_type is None:
            site_type = self.detect_site_type(url)
        
        if not site_type:
            site_type = "ecommerce_general"
        
        strategy = self.get_strategy(site_type)
        if not strategy:
            raise ValueError(f"No extraction strategy for site type: {site_type}")
        
        # Add review extraction if requested
        if extract_reviews:
            review_fields = [
                {"name": "reviews", "selector": ".review, .customer-review", "type": "text", "multiple": True},
                {"name": "average_rating", "selector": ".avg-rating", "type": "text"},
                {"name": "review_count", "selector": ".review-count", "type": "text"}
            ]
            strategy.fields.extend(review_fields)
        
        config = CrawlerRunConfig(
            extraction_strategy=strategy,
            **(crawler_config or {})
        )
        
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=url, config=config)
            
            if not result.success or not result.extracted_content:
                return ExtractionResult([], 0.0, site_type, ["No content extracted"])
            
            try:
                extracted_data = json.loads(result.extracted_content)
                if isinstance(extracted_data, list):
                    data = extracted_data[:max_results]
                else:
                    data = [extracted_data] if extracted_data else []
                
                # Clean and validate product data
                cleaned_data = self._clean_product_data(data)
                
                # Calculate confidence
                confidence = self._calculate_ecommerce_confidence(cleaned_data)
                
                warnings = []
                if len(cleaned_data) < len(data):
                    warnings.append(f"Cleaned {len(data) - len(cleaned_data)} invalid products")
                
                return ExtractionResult(
                    data=cleaned_data,
                    confidence=confidence,
                    matched_site_type=site_type,
                    warnings=warnings
                )
                
            except json.JSONDecodeError as e:
                return ExtractionResult([], 0.0, site_type, [f"JSON parsing error: {str(e)}"])
    
    def _clean_product_data(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Clean and validate extracted product data."""
        cleaned = []
        
        for item in data:
            if not isinstance(item, dict):
                continue
            
            cleaned_item = {}
            
            # Required fields check
            if item.get("product_name") and str(item["product_name"]).strip():
                cleaned_item["product_name"] = str(item["product_name"]).strip()
            else:
                continue  # Skip products without name
            
            # Clean price
            price = item.get("price", "")
            if price:
                # Extract numeric price
                price_match = re.search(r'[\d,.]+', str(price))
                if price_match:
                    cleaned_item["price"] = price_match.group()
                cleaned_item["price_raw"] = str(price).strip()
            
            # Clean other fields
            for key, value in item.items():
                if key not in ["product_name", "price"] and value:
                    cleaned_item[key] = str(value).strip()
            
            cleaned.append(cleaned_item)
        
        return cleaned
    
    def _calculate_ecommerce_confidence(self, data: List[Dict[str, Any]]) -> float:
        """Calculate confidence score for e-commerce extraction."""
        if not data:
            return 0.0
        
        required_fields = {"product_name", "price"}
        total_items = len(data)
        complete_items = 0
        
        for item in data:
            if all(field in item and item[field] for field in required_fields):
                complete_items += 1
        
        completeness = complete_items / total_items if total_items > 0 else 0
        
        # Additional quality checks
        quality_score = 0.0
        for item in data:
            name_length = len(str(item.get("product_name", "")).split())
            price_valid = bool(re.search(r'[\d,.]+', str(item.get("price", ""))))
            
            if name_length > 1 and price_valid:
                quality_score += 1
        
        avg_quality = quality_score / total_items if total_items > 0 else 0
        
        # Combined confidence
        return min(1.0, completeness * 0.7 + avg_quality * 0.3)

# Integration and usage examples
async def domain_specific_extraction_example():
    """Example demonstrating domain-specific extractors."""
    
    # Academic extraction example
    print("=== Academic Paper Extraction ===")
    academic_extractor = AcademicExtractor()
    
    arxiv_result = await academic_extractor.extract_papers(
        url="https://arxiv.org/list/cs.AI/recent",
        site_type="arxiv",
        max_results=5
    )
    
    print(f"arXiv Papers: {len(arxiv_result.data)}")
    for paper in arxiv_result.data[:2]:
        print(f"  - {paper.get('title', 'No title')[:100]}...")
        print(f"    Authors: {paper.get('authors', 'N/A')}")
        print(f"    PDF: {paper.get('pdf_url', 'N/A')}")
    
    # E-commerce extraction example
    print("\n=== E-commerce Product Extraction ===")
    ecommerce_extractor = EcommerceExtractor()
    
    product_result = await ecommerce_extractor.extract_products(
        url="https://www.amazon.com/s?k=laptop",
        site_type="amazon",
        max_results=5,
        extract_reviews=True
    )
    
    print(f"Products: {len(product_result.data)}")
    for product in product_result.data[:2]:
        print(f"  - {product.get('product_name', 'No name')[:50]}...")
        print(f"    Price: ${product.get('price', 'N/A')}")
        print(f"    Rating: {product.get('rating', 'N/A')}")
        print(f"    Reviews: {product.get('reviews_count', 'N/A')}")
    
    return arxiv_result, product_result

# Usage in crawler
async def integrated_usage_example():
    """Example showing integration with AsyncWebCrawler."""
    async with AsyncWebCrawler() as crawler:
        # Academic extraction
        academic_extractor = AcademicExtractor()
        academic_strategy = academic_extractor.get_strategy("arxiv")
        
        if academic_strategy:
            config = CrawlerRunConfig(extraction_strategy=academic_strategy)
            result = await crawler.arun(
                url="https://arxiv.org/list/cs.AI/recent",
                config=config
            )
            
            if result.extracted_content:
                papers = json.loads(result.extracted_content)
                print(f"Extracted {len(papers)} papers")
        
        # E-commerce extraction
        ecommerce_extractor = EcommerceExtractor()
        ecommerce_strategy = ecommerce_extractor.get_strategy("amazon")
        
        if ecommerce_strategy:
            config = CrawlerRunConfig(extraction_strategy=ecommerce_strategy)
            result = await crawler.arun(
                url="https://www.amazon.com/s?k=books",
                config=config
            )
            
            if result.extracted_content:
                products = json.loads(result.extracted_content)
                print(f"Extracted {len(products)} products")