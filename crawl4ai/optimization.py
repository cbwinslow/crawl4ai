from typing import List, Dict, Any, Optional, Tuple, Union
import numpy as np
from dataclasses import dataclass
from crawl4ai.models import CrawlResult
from crawl4ai.async_configs import CrawlerRunConfig
import asyncio
from .utils import get_text_embeddings, cosine_similarity
import json

@dataclass
class OptimizationResult:
    """Result of knowledge optimization process."""
    knowledge_coverage: float  # 0.0-1.0 percentage of required knowledge covered
    efficiency_ratio: float    # bytes of content per unit of knowledge covered
    optimal_content: str       # The minimal content that achieves the coverage
    covered_knowledge: List[str]  # Which knowledge areas were covered
    total_content_length: int  # Total length of all crawled content
    selected_chunks: List[Dict[str, Any]]  # Selected content chunks with metadata

class KnowledgeOptimizer:
    """
    Knowledge-Optimal Crawler optimizer that minimizes data extraction while maximizing
    knowledge acquisition for specific objectives.
    
    Key Features:
    - Smart content prioritization based on semantic relevance
    - Minimal data extraction for maximum knowledge coverage
    - Probabilistic relevance assessment using embeddings
    - Objective-driven crawling path optimization
    - Efficiency scoring and content selection
    """
    
    def __init__(
        self,
        objective: str,
        required_knowledge: List[str],
        confidence_threshold: float = 0.85,
        embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2",
        chunk_size: int = 512,
        overlap: int = 50,
        max_content_length: int = 10000,
        **kwargs
    ):
        """
        Initialize the KnowledgeOptimizer.
        
        Args:
            objective: The main objective or goal of the crawling (used for context)
            required_knowledge: List of specific knowledge areas/topics to extract
            confidence_threshold: Minimum similarity score for content relevance (0.0-1.0)
            embedding_model: Model to use for semantic similarity (local or API)
            chunk_size: Maximum size of content chunks for analysis
            overlap: Overlap between chunks for better coverage
            max_content_length: Maximum total content length to consider
            **kwargs: Additional configuration options
        """
        self.objective = objective
        self.required_knowledge = [item.strip() for item in required_knowledge if item.strip()]
        self.confidence_threshold = confidence_threshold
        self.embedding_model = embedding_model
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.max_content_length = max_content_length
        
        # Pre-compute embeddings for required knowledge
        self.knowledge_embeddings = None
        self._embedding_cache = {}
        
        # Efficiency tracking
        self.total_processed = 0
        self.coverage_history = []
        
        # Extract knowledge topics for matching
        self.knowledge_topics = self.required_knowledge.copy()
        if objective:
            self.knowledge_topics.append(objective)
    
    async def _get_knowledge_embeddings(self) -> np.ndarray:
        """Get embeddings for all required knowledge topics."""
        if self.knowledge_embeddings is not None:
            return self.knowledge_embeddings
        
        # Use async embedding function
        embeddings = await get_text_embeddings(
            self.knowledge_topics,
            model_name=self.embedding_model
        )
        
        self.knowledge_embeddings = embeddings
        return embeddings
    
    def _chunk_content(self, content: str) -> List[Tuple[str, int]]:
        """
        Chunk content into overlapping segments for analysis.
        
        Args:
            content: The markdown or text content to chunk
            
        Returns:
            List of (chunk_text, start_position) tuples
        """
        if not content:
            return []
        
        chunks = []
        start = 0
        
        while start < len(content):
            # Simple character-based chunking with overlap
            end = min(start + self.chunk_size, len(content))
            
            # Ensure we don't cut off in the middle of a sentence
            if end < len(content):
                # Find the last sentence boundary
                last_period = content.rfind('.', start, end)
                last_newline = content.rfind('\n', start, end)
                sentence_end = max(last_period, last_newline)
                if sentence_end > start + 100:  # Reasonable sentence length
                    end = sentence_end + 1
            
            chunk = content[start:end].strip()
            if len(chunk) > 50:  # Minimum chunk size
                chunks.append((chunk, start))
            
            start = end - self.overlap
            if start >= len(content):
                break
        
        return chunks
    
    async def _score_content_chunks(
        self, 
        chunks: List[Tuple[str, int]], 
        knowledge_embeddings: np.ndarray
    ) -> List[Dict[str, Any]]:
        """
        Score content chunks against knowledge requirements.
        
        Args:
            chunks: List of (chunk_text, position) tuples
            knowledge_embeddings: Embeddings of required knowledge topics
            
        Returns:
            List of scored chunks with relevance information
        """
        scored_chunks = []
        
        # Get embeddings for all chunks at once (efficient)
        chunk_texts = [chunk[0] for chunk in chunks]
        chunk_embeddings = await get_text_embeddings(
            chunk_texts,
            model_name=self.embedding_model
        )
        
        for i, (chunk_text, position) in enumerate(chunks):
            if i >= len(chunk_embeddings):
                continue
                
            chunk_emb = chunk_embeddings[i]
            chunk_scores = []
            
            # Calculate similarity to each knowledge topic
            for j, knowledge_emb in enumerate(knowledge_embeddings):
                if np.any(knowledge_emb) and np.any(chunk_emb):
                    similarity = cosine_similarity(chunk_emb, knowledge_emb)
                    if similarity >= self.confidence_threshold:
                        chunk_scores.append({
                            'topic': self.knowledge_topics[j],
                            'similarity': float(similarity),
                            'covered': True
                        })
            
            # Chunk metadata
            chunk_data = {
                'text': chunk_text,
                'position': position,
                'length': len(chunk_text),
                'knowledge_coverage': len(chunk_scores),
                'topics_covered': [s['topic'] for s in chunk_scores],
                'avg_similarity': np.mean([s['similarity'] for s in chunk_scores]) if chunk_scores else 0.0,
                'scores': chunk_scores
            }
            
            scored_chunks.append(chunk_data)
        
        return scored_chunks
    
    def _select_optimal_content(
        self, 
        scored_chunks: List[Dict[str, Any]], 
        target_coverage: float = 0.9
    ) -> OptimizationResult:
        """
        Select minimal content that achieves target knowledge coverage.
        
        Args:
            scored_chunks: List of scored content chunks
            target_coverage: Target coverage percentage (0.0-1.0)
            
        Returns:
            OptimizationResult with selected content and metrics
        """
        if not scored_chunks:
            return OptimizationResult(
                knowledge_coverage=0.0,
                efficiency_ratio=float('inf'),
                optimal_content="",
                covered_knowledge=[],
                total_content_length=0,
                selected_chunks=[]
            )
        
        # Track coverage of each knowledge topic
        topic_coverage = {topic: False for topic in self.required_knowledge}
        total_covered = 0
        total_required = len(self.required_knowledge)
        
        # Sort chunks by efficiency (coverage per length)
        scored_chunks.sort(
            key=lambda x: (x['knowledge_coverage'] / x['length']) if x['length'] > 0 else 0,
            reverse=True
        )
        
        selected_chunks = []
        selected_content = []
        total_length = 0
        
        for chunk in scored_chunks:
            if total_covered >= total_required * target_coverage:
                break
            
            # Check if this chunk covers new topics
            new_topics = [
                topic for topic in chunk['topics_covered']
                if topic in topic_coverage and not topic_coverage[topic]
            ]
            
            if new_topics:
                selected_chunks.append(chunk)
                selected_content.append(chunk['text'])
                total_length += chunk['length']
                
                # Mark topics as covered
                for topic in new_topics:
                    topic_coverage[topic] = True
                    total_covered += 1
        
        # Calculate final metrics
        final_coverage = total_covered / total_required if total_required > 0 else 0.0
        efficiency = total_length / max(total_covered, 1)  # Avoid division by zero
        
        optimal_content = "\n\n".join(selected_content)
        
        # Ensure we don't exceed max content length
        if len(optimal_content) > self.max_content_length:
            optimal_content = optimal_content[:self.max_content_length] + "..."
        
        covered_topics = [topic for topic, covered in topic_coverage.items() if covered]
        
        return OptimizationResult(
            knowledge_coverage=final_coverage,
            efficiency_ratio=efficiency,
            optimal_content=optimal_content,
            covered_knowledge=covered_topics,
            total_content_length=total_length,
            selected_chunks=selected_chunks
        )
    
    async def optimize_crawl_results(
        self,
        crawl_results: List[CrawlResult],
        target_coverage: float = 0.9
    ) -> OptimizationResult:
        """
        Optimize a list of crawl results for knowledge coverage.
        
        Args:
            crawl_results: List of CrawlResult objects from crawling
            target_coverage: Target coverage percentage (0.0-1.0)
            
        Returns:
            OptimizationResult with optimized content selection
        """
        if not crawl_results:
            return OptimizationResult(0.0, float('inf'), "", [], 0, [])
        
        # Get knowledge embeddings
        knowledge_embeddings = await self._get_knowledge_embeddings()
        
        all_scored_chunks = []
        
        for result in crawl_results:
            if not result.success or not result.markdown:
                continue
            
            # Chunk the markdown content
            chunks = self._chunk_content(result.markdown)
            
            if not chunks:
                continue
            
            # Score chunks against knowledge requirements
            scored_chunks = await self._score_content_chunks(chunks, knowledge_embeddings)
            
            # Add source metadata to each chunk
            for chunk in scored_chunks:
                chunk['source_url'] = result.url
                chunk['crawl_metadata'] = {
                    'success': result.success,
                    'content_length': len(result.markdown),
                    'media_count': len(result.media.get('images', []) + result.media.get('videos', []))
                }
            
            all_scored_chunks.extend(scored_chunks)
        
        # Select optimal content
        optimization_result = self._select_optimal_content(
            all_scored_chunks, 
            target_coverage
        )
        
        # Add optimization metadata
        optimization_result.optimization_config = {
            'objective': self.objective,
            'required_knowledge': self.required_knowledge,
            'confidence_threshold': self.confidence_threshold,
            'target_coverage': target_coverage,
            'total_chunks_processed': len(all_scored_chunks),
            'chunks_selected': len(optimization_result.selected_chunks)
        }
        
        self.total_processed += len(all_scored_chunks)
        self.coverage_history.append(optimization_result.knowledge_coverage)
        
        return optimization_result
    
    async def optimize_multiple_urls(
        self,
        urls: List[str],
        crawler_config: Optional[CrawlerRunConfig] = None,
        target_coverage: float = 0.9,
        max_concurrent: int = 3,
        **kwargs
    ) -> OptimizationResult:
        """
        Crawl multiple URLs and optimize for knowledge coverage.
        
        Args:
            urls: List of URLs to crawl and analyze
            crawler_config: Configuration for the crawler
            target_coverage: Target knowledge coverage percentage
            max_concurrent: Maximum concurrent crawls
            **kwargs: Additional parameters for crawling
            
        Returns:
            OptimizationResult with crawling and optimization results
        """
        from crawl4ai import AsyncWebCrawler
        
        if not urls:
            return OptimizationResult(0.0, float('inf'), "", [], 0, [])
        
        # Ensure we have a crawler instance
        if not hasattr(self, 'crawler') or self.crawler is None:
            self.crawler = AsyncWebCrawler()
            await self.crawler.start()
        
        crawler_config = crawler_config or CrawlerRunConfig(
            cache_mode="bypass",  # Fresh content for optimization
            verbose=False,
            **kwargs
        )
        
        # Crawl URLs concurrently with semaphore
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def crawl_url(url: str) -> Optional[CrawlResult]:
            async with semaphore:
                try:
                    # Handle single URL crawling
                    if isinstance(url, str):
                        result = await self.crawler.arun(
                            url=url,
                            config=crawler_config
                        )
                    else:
                        result = None
                    
                    return result if result and result.success else None
                except Exception as e:
                    print(f"Error crawling {url}: {str(e)}")
                    return None
        
        # Execute crawling
        crawl_tasks = [crawl_url(url) for url in urls]
        crawl_results = await asyncio.gather(*crawl_tasks, return_exceptions=True)
        
        # Filter successful results
        successful_results = [
            result for result in crawl_results 
            if isinstance(result, CrawlResult) and result.success
        ]
        
        if not successful_results:
            return OptimizationResult(0.0, float('inf'), "No successful crawls", [], 0, [])
        
        # Optimize the results
        optimization_result = await self.optimize_crawl_results(
            successful_results,
            target_coverage
        )
        
        # Add crawling metadata
        optimization_result.crawling_metadata = {
            'urls_crawled': len(urls),
            'successful_crawls': len(successful_results),
            'failed_crawls': len(urls) - len(successful_results),
            'total_content_extracted': sum(len(r.markdown or '') for r in successful_results)
        }
        
        return optimization_result

# Integration with AsyncWebCrawler
async def integrate_with_crawler_example():
    """Example showing integration with AsyncWebCrawler."""
    from crawl4ai import AsyncWebCrawler
    
    urls = [
        "https://aws.amazon.com/ec2/pricing/",
        "https://cloud.google.com/gpu",
        "https://azure.microsoft.com/pricing/"
    ]
    
    async with AsyncWebCrawler() as crawler:
        optimizer = KnowledgeOptimizer(
            objective="Understand GPU instance pricing and limitations across cloud providers",
            required_knowledge=[
                "pricing structure",
                "GPU specifications", 
                "usage limits",
                "availability zones"
            ],
            confidence_threshold=0.85
        )
        
        # Use the optimizer with multiple URLs
        result = await optimizer.optimize_multiple_urls(
            urls=urls,
            crawler_config=CrawlerRunConfig(
                cache_mode="bypass",
                screenshot=False,
                pdf=False
            ),
            target_coverage=0.9,
            max_concurrent=2
        )
        
        print(f"Knowledge Coverage: {result.knowledge_coverage:.1%}")
        print(f"Data Efficiency: {result.efficiency_ratio:.1f} chars/knowledge")
        print(f"Extracted Content Length: {len(result.optimal_content)} chars")
        print(f"Covered Topics: {', '.join(result.covered_knowledge)}")
        
        # The optimal content is ready for use
        optimal_content = result.optimal_content
        
        return result