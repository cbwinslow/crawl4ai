from typing import List, Dict, Any, Optional
import os
import asyncio
from serpapi import GoogleSearch
from crawl4ai import AsyncWebCrawler
from crawl4ai.models import CrawlResult
from crawl4ai.content_filter_strategy import BM25ContentFilter
from crawl4ai.chunking_strategy import RegexChunking
import json

class QuestionBasedDiscovery:
    """
    Question-Based Discovery system for intelligent URL discovery and content extraction
    based on natural language questions using SerpAPI integration.
    
    Key Features:
    - SerpAPI integration for intelligent web search
    - Relevancy scoring using BM25 on search result snippets
    - Automatic URL prioritization and filtering
    - Cross-source validation through crawling top results
    - Configurable thresholds for relevance and result limits
    """
    
    def __init__(
        self,
        crawler: AsyncWebCrawler,
        serpapi_api_key: Optional[str] = None,
        bm25_threshold: float = 0.7,
        max_snippet_length: int = 500,
        **kwargs
    ):
        """
        Initialize the QuestionBasedDiscovery.
        
        Args:
            crawler: The AsyncWebCrawler instance to use for content extraction
            serpapi_api_key: SerpAPI API key (defaults to SERPAPI_API_KEY env var)
            bm25_threshold: Minimum BM25 relevance score for URLs (0.0-1.0)
            max_snippet_length: Maximum length for snippets used in relevance scoring
            **kwargs: Additional parameters for crawler configuration
        """
        self.crawler = crawler
        self.api_key = serpapi_api_key or os.getenv("SERPAPI_API_KEY")
        if not self.api_key:
            raise ValueError("SERPAPI_API_KEY environment variable or api_key parameter required")
        
        # Initialize BM25 filter for relevance scoring
        self.bm25_filter = BM25ContentFilter(
            word_count_threshold=5,  # Minimum words for snippet relevance
            bm25_threshold=bm25_threshold
        )
        self.chunking_strategy = RegexChunking()
        self.max_snippet_length = max_snippet_length
        self.default_params = kwargs.get("search_params", {
            "num": 20,  # Get more results to filter
            "location": "United States",
            "hl": "en",
            "gl": "us"
        })
    
    async def _search_urls(self, question: str, max_urls: int = 10) -> List[Dict[str, Any]]:
        """
        Perform SerpAPI search and return scored URLs.
        
        Args:
            question: Natural language search query
            max_urls: Maximum number of URLs to return after filtering
            
        Returns:
            List of dicts with URL data including relevance scores
        """
        params = self.default_params.copy()
        params.update({
            "q": question,
            "num": min(max_urls * 2, 20),  # Get extra for filtering
            "api_key": self.api_key
        })
        
        try:
            search = GoogleSearch(params)
            results = search.get_dict()
            
            organic_results = results.get("organic_results", [])
            if not organic_results:
                return []
            
            # Prepare documents for BM25 scoring
            query_doc = [question.lower()]
            search_docs = []
            
            scored_urls = []
            for result in organic_results:
                # Extract relevant text for scoring
                title = result.get("title", "")
                snippet = result.get("snippet", "")
                
                # Combine title and snippet, truncate if too long
                combined_text = f"{title} {snippet}".lower()[:self.max_snippet_length]
                
                if len(combined_text.split()) < 3:  # Skip very short results
                    continue
                
                search_docs.append([combined_text])
                
                # Basic metadata
                url_data = {
                    "url": result.get("link", ""),
                    "title": title,
                    "snippet": snippet,
                    "position": len(scored_urls) + 1,
                    "relevance_score": 0.0,
                    "source": "serpapi"
                }
                
                scored_urls.append(url_data)
            
            if not search_docs:
                return []
            
            # Score all documents at once using BM25
            try:
                scores = self.bm25_filter._score_documents(
                    query_doc, search_docs, self.chunking_strategy
                )
                
                # Assign scores to URLs
                for i, score in enumerate(scores):
                    if i < len(scored_urls):
                        scored_urls[i]["relevance_score"] = float(score[0]) if score else 0.0
                
                # Sort by relevance score descending, then by position
                scored_urls.sort(
                    key=lambda x: (x["relevance_score"], -x["position"]),
                    reverse=True
                )
                
                # Filter by threshold and limit
                filtered_urls = [
                    url for url in scored_urls
                    if url["relevance_score"] >= self.bm25_filter.bm25_threshold
                ][:max_urls]
                
                return filtered_urls
                
            except Exception as e:
                # Fallback: simple position-based scoring
                for i, url_data in enumerate(scored_urls[:max_urls]):
                    url_data["relevance_score"] = 1.0 - (i / max_urls)
                return scored_urls[:max_urls]
                
        except Exception as e:
            print(f"Search error: {str(e)}")
            return []
    
    async def _crawl_and_validate(
        self, 
        urls: List[Dict[str, Any]], 
        crawler_config: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        Crawl URLs and validate content relevance.
        
        Args:
            urls: List of URL dictionaries from search
            crawler_config: Configuration for crawling
            
        Returns:
            List of results with crawled content and validation
        """
        if not urls:
            return []
        
        validated_results = []
        crawler_config = crawler_config or {}
        
        # Prepare crawler run config
        from crawl4ai.async_configs import CrawlerRunConfig
        run_config = CrawlerRunConfig(
            cache_mode="bypass",  # Always fresh content for discovery
            verbose=False,
            **crawler_config
        )
        
        # Crawl URLs concurrently but limit to avoid overwhelming
        semaphore = asyncio.Semaphore(3)  # Limit concurrent crawls
        
        async def crawl_single(url_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            async with semaphore:
                try:
                    result = await self.crawler.arun(
                        url=url_data["url"],
                        config=run_config
                    )
                    
                    if result.success and result.markdown:
                        # Basic content validation
                        content_length = len(result.markdown.split())
                        if content_length > 50:  # Minimum meaningful content
                            url_data.update({
                                "crawl_success": True,
                                "markdown": result.markdown,
                                "content_length": content_length,
                                "media": result.media,
                                "links": result.links,
                                "metadata": result.metadata
                            })
                            return url_data
                        else:
                            url_data["crawl_success"] = False
                            url_data["error"] = "Insufficient content"
                            return None
                    else:
                        url_data["crawl_success"] = False
                        url_data["error"] = result.error_message or "Crawl failed"
                        return None
                        
                except Exception as e:
                    url_data["crawl_success"] = False
                    url_data["error"] = str(e)
                    return None
        
        # Execute crawls
        tasks = [crawl_single(url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Filter successful results
        for result in results:
            if isinstance(result, dict) and result.get("crawl_success"):
                validated_results.append(result)
        
        return validated_results
    
    async def arun(
        self,
        question: str,
        max_urls: int = 5,
        relevance_threshold: float = 0.7,
        crawl: bool = True,
        crawler_config: Optional[Dict[str, Any]] = None,
        validate_content: bool = True,
        **search_params
    ) -> List[Dict[str, Any]]:
        """
        Run question-based discovery: search, score, crawl, and validate.
        
        Args:
            question: Natural language question for search and discovery
            max_urls: Maximum number of final URLs to return
            relevance_threshold: Minimum relevance score for inclusion (0.0-1.0)
            crawl: Whether to crawl and extract content from discovered URLs
            crawler_config: Configuration dictionary for AsyncWebCrawler
            validate_content: Whether to validate crawled content quality
            **search_params: Additional parameters for SerpAPI search
            
        Returns:
            List of discovery results with URLs, scores, and content
        """
        if not question.strip():
            raise ValueError("Question cannot be empty")
        
        # Step 1: Search and score URLs
        print(f"🔍 Searching for: '{question}' (max_urls={max_urls})")
        search_results = await self._search_urls(
            question, 
            max_urls=max_urls * 2  # Get more for filtering
        )
        
        if not search_results:
            print("No search results found")
            return []
        
        # Update threshold if provided
        if relevance_threshold is not None:
            self.bm25_filter.bm25_threshold = relevance_threshold
        
        # Filter by threshold
        filtered_results = [
            result for result in search_results
            if result["relevance_score"] >= relevance_threshold
        ]
        
        print(f"Found {len(filtered_results)} relevant URLs (threshold={relevance_threshold})")
        
        if not filtered_results:
            return []
        
        # Step 2: Crawl and validate (if enabled)
        if crawl:
            print("🕷️  Crawling top URLs...")
            final_results = await self._crawl_and_validate(
                filtered_results[:max_urls],
                crawler_config or {}
            )
        else:
            # Return just search results without crawling
            final_results = filtered_results[:max_urls]
            for result in final_results:
                result.update({
                    "crawl_success": False,
                    "markdown": None,
                    "content_length": 0
                })
        
        # Step 3: Cross-source validation (basic aggregation)
        if len(final_results) > 1 and validate_content:
            # Simple validation: check for content overlap or consistency
            # This could be expanded with more sophisticated validation
            validated = []
            seen_content = set()
            
            for result in final_results:
                if result.get("markdown"):
                    content_hash = hash(result["markdown"][:200])  # Hash first 200 chars
                    if content_hash not in seen_content:
                        seen_content.add(content_hash)
                        validated.append(result)
                else:
                    validated.append(result)
            
            final_results = validated[:max_urls]
        
        print(f"✅ Discovery complete: {len(final_results)} validated results")
        
        return final_results

# Example usage integration
async def example_usage():
    """Example of how to use QuestionBasedDiscovery"""
    async with AsyncWebCrawler() as crawler:
        discovery = QuestionBasedDiscovery(crawler)
        
        results = await discovery.arun(
            question="What are the system requirements for major cloud providers' GPU instances?",
            max_urls=5,
            relevance_threshold=0.7,
            crawl=True
        )
        
        for result in results:
            print(f"Source: {result['url']} (Relevance: {result['relevance_score']:.2f})")
            if result.get('markdown'):
                print(f"Content preview: {result['markdown'][:200]}...\n")
    
    return results