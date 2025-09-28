from typing import List, Dict, Any, Optional, Union
import json
import asyncio
import numpy as np
from dataclasses import dataclass
import os
from pathlib import Path
from crawl4ai import AsyncWebCrawler
from crawl4ai.async_configs import CrawlerRunConfig
from crawl4ai.models import CrawlResult
from .utils import get_text_embeddings, cosine_similarity
import pickle
from datetime import datetime, timedelta

@dataclass
class SearchResult:
    """Represents a search result from the web index."""
    content: str  # The chunk of content
    url: str      # Source URL
    title: str    # Page title
    score: float  # Relevance score (0.0-1.0)
    metadata: Dict[str, Any]  # Additional metadata
    chunk_id: str  # Unique identifier for the chunk

class WebIndex:
    """
    Web Embedding Index for semantic search of crawled content.
    
    Creates and maintains a semantic search infrastructure for crawled web content,
    enabling efficient retrieval and querying through vector embeddings.
    
    Key Features:
    - Automatic embedding generation using transformer models
    - Intelligent content chunking (semantic, fixed-size, or hybrid)
    - Efficient vector storage with optional persistence
    - Semantic search with filtering capabilities
    - Incremental updates and cache management
    """
    
    def __init__(
        self,
        model: str = "sentence-transformers/all-MiniLM-L6-v2",
        chunk_method: str = "semantic",
        chunk_size: int = 512,
        overlap: int = 50,
        embedding_dim: Optional[int] = None,
        storage_path: Optional[str] = None,
        update_policy: str = "incremental",
        embedding_batch_size: int = 32,
        **kwargs
    ):
        """
        Initialize the WebIndex.
        
        Args:
            model: Embedding model name (sentence-transformers or API provider)
            chunk_method: "semantic", "fixed", or "hybrid" chunking
            chunk_size: Maximum characters per chunk
            overlap: Character overlap between chunks
            embedding_dim: Expected embedding dimension (auto-detected if None)
            storage_path: Path for persistent storage (None for in-memory)
            update_policy: "incremental", "full", or "append"
            embedding_batch_size: Batch size for embedding generation
            **kwargs: Additional configuration options
        """
        self.model = model
        self.chunk_method = chunk_method
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.embedding_dim = embedding_dim
        self.storage_path = storage_path
        self.update_policy = update_policy
        self.embedding_batch_size = embedding_batch_size
        
        # Internal state
        self.embeddings: np.ndarray = np.array([])
        self.documents: List[Dict[str, Any]] = []
        self.metadata_index: Dict[str, int] = {}  # chunk_id -> document index
        self.url_index: Dict[str, List[int]] = {}  # url -> list of document indices
        
        # Storage setup
        if storage_path:
            self._storage_path = Path(storage_path)
            self._storage_path.mkdir(parents=True, exist_ok=True)
            self._load_index()
        else:
            self._storage_path = None
        
        # Chunking strategy
        self._chunker = self._get_chunker(chunk_method)
    
    def _get_chunker(self, method: str):
        """Get appropriate chunking function based on method."""
        if method == "semantic":
            return self._semantic_chunk
        elif method == "fixed":
            return self._fixed_chunk
        elif method == "hybrid":
            return self._hybrid_chunk
        else:
            raise ValueError(f"Unknown chunk method: {method}")
    
    def _fixed_chunk(self, text: str) -> List[str]:
        """Fixed-size chunking with overlap."""
        chunks = []
        start = 0
        
        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            chunk = text[start:end].strip()
            
            if len(chunk) > 100:  # Minimum chunk size
                chunks.append(chunk)
            
            start = end - self.overlap
            if start >= len(text):
                break
        
        return chunks
    
    def _semantic_chunk(self, text: str) -> List[str]:
        """Semantic chunking using sentence boundaries."""
        # Simple sentence-based chunking
        sentences = re.split(r'(?<=[.!?])\s+', text)
        chunks = []
        current_chunk = ""
        
        for sentence in sentences:
            if len(current_chunk + sentence) < self.chunk_size:
                current_chunk += " " + sentence
            else:
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())
                current_chunk = sentence
        
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        # Ensure minimum overlap by merging small chunks
        merged_chunks = []
        for chunk in chunks:
            if len(chunk) < 100 and merged_chunks:
                merged_chunks[-1] += " " + chunk
            else:
                merged_chunks.append(chunk)
        
        return merged_chunks
    
    def _hybrid_chunk(self, text: str) -> List[str]:
        """Hybrid chunking: semantic within fixed windows."""
        # First apply fixed chunking
        fixed_chunks = self._fixed_chunk(text)
        
        # Then apply semantic splitting within each chunk
        semantic_chunks = []
        for chunk in fixed_chunks:
            semantic_chunks.extend(self._semantic_chunk(chunk))
        
        return semantic_chunks
    
    async def _get_embeddings(self, texts: List[str]) -> np.ndarray:
        """Get embeddings for texts using the specified model."""
        if not texts:
            return np.array([])
        
        embeddings = await get_text_embeddings(
            texts,
            model_name=self.model,
            batch_size=self.embedding_batch_size
        )
        
        if self.embedding_dim and embeddings.shape[1] != self.embedding_dim:
            raise ValueError(f"Embedding dimension mismatch: expected {self.embedding_dim}, got {embeddings.shape[1]}")
        
        self.embedding_dim = embeddings.shape[1] if self.embedding_dim is None else self.embedding_dim
        return embeddings
    
    def _store_index(self):
        """Store index to disk if persistence is enabled."""
        if not self._storage_path:
            return
        
        try:
            # Store embeddings
            np.save(self._storage_path / "embeddings.npy", self.embeddings)
            
            # Store documents
            with open(self._storage_path / "documents.json", "w") as f:
                json.dump(self.documents, f, default=str)
            
            # Store indices
            with open(self._storage_path / "metadata_index.pkl", "wb") as f:
                pickle.dump(self.metadata_index, f)
            
            with open(self._storage_path / "url_index.pkl", "wb") as f:
                pickle.dump(self.url_index, f)
            
            # Store metadata
            index_meta = {
                "model": self.model,
                "chunk_method": self.chunk_method,
                "chunk_size": self.chunk_size,
                "embedding_dim": self.embedding_dim,
                "document_count": len(self.documents),
                "last_updated": datetime.now().isoformat()
            }
            
            with open(self._storage_path / "index_meta.json", "w") as f:
                json.dump(index_meta, f)
                
        except Exception as e:
            print(f"Warning: Failed to store index: {str(e)}")
    
    def _load_index(self):
        """Load index from disk if it exists."""
        if not self._storage_path or not self._storage_path.exists():
            return
        
        try:
            # Load embeddings
            if (self._storage_path / "embeddings.npy").exists():
                self.embeddings = np.load(self._storage_path / "embeddings.npy")
            
            # Load documents
            if (self._storage_path / "documents.json").exists():
                with open(self._storage_path / "documents.json", "r") as f:
                    self.documents = json.load(f)
            
            # Load indices
            if (self._storage_path / "metadata_index.pkl").exists():
                with open(self._storage_path / "metadata_index.pkl", "rb") as f:
                    self.metadata_index = pickle.load(f)
            
            if (self._storage_path / "url_index.pkl").exists():
                with open(self._storage_path / "url_index.pkl", "rb") as f:
                    self.url_index = pickle.load(f)
            
            # Load metadata
            if (self._storage_path / "index_meta.json").exists():
                with open(self._storage_path / "index_meta.json", "r") as f:
                    meta = json.load(f)
                    self.model = meta.get("model", self.model)
                    self.chunk_method = meta.get("chunk_method", self.chunk_method)
                    self.chunk_size = meta.get("chunk_size", self.chunk_size)
                    self.embedding_dim = meta.get("embedding_dim")
            
            print(f"Loaded index with {len(self.documents)} documents")
            
        except Exception as e:
            print(f"Warning: Failed to load index: {str(e)}")
            # Reset to empty index
            self._reset_index()
    
    def _reset_index(self):
        """Reset the index to empty state."""
        self.embeddings = np.array([])
        self.documents = []
        self.metadata_index = {}
        self.url_index = {}
        if self._storage_path:
            for file in self._storage_path.glob("*.npy"):
                file.unlink()
            for file in self._storage_path.glob("*.json"):
                if file.name != "index_meta.json":
                    file.unlink()
            for file in self._storage_path.glob("*.pkl"):
                file.unlink()
    
    async def build(
        self,
        urls: List[str],
        crawler: Optional[AsyncWebCrawler] = None,
        options: Optional[Dict[str, Any]] = None,
        incremental: bool = True
    ) -> Dict[str, Any]:
        """
        Build or update the web index by crawling URLs and generating embeddings.
        
        Args:
            urls: List of URLs to crawl and index
            crawler: Optional AsyncWebCrawler instance (creates new if None)
            options: Build options including chunking and filtering
            incremental: Whether to add to existing index or rebuild
            
        Returns:
            Dictionary with build statistics
        """
        options = options or {}
        chunk_method = options.get("chunk_method", self.chunk_method)
        update_policy = options.get("update_policy", self.update_policy)
        
        # Update chunker if method changed
        self.chunk_method = chunk_method
        self._chunker = self._get_chunker(chunk_method)
        
        if not incremental and update_policy == "full":
            self._reset_index()
        
        if crawler is None:
            crawler = AsyncWebCrawler()
            await crawler.start()
        
        build_stats = {
            "urls_processed": 0,
            "documents_added": 0,
            "chunks_created": 0,
            "embeddings_generated": 0,
            "errors": []
        }
        
        # Crawl URLs
        crawl_config = CrawlerRunConfig(
            cache_mode="bypass" if incremental else "bypass",
            verbose=False,
            screenshot=False,
            pdf=False,
            **options.get("crawler_config", {})
        )
        
        semaphore = asyncio.Semaphore(options.get("max_concurrent", 3))
        
        async def process_url(url: str) -> Optional[CrawlResult]:
            async with semaphore:
                try:
                    result = await crawler.arun(url=url, config=crawl_config)
                    build_stats["urls_processed"] += 1
                    return result if result.success else None
                except Exception as e:
                    build_stats["errors"].append(f"Error crawling {url}: {str(e)}")
                    return None
        
        # Execute crawling
        tasks = [process_url(url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        successful_results = [
            r for r in results 
            if isinstance(r, CrawlResult) and r.success and r.markdown
        ]
        
        # Process each successful result
        new_embeddings = []
        new_documents = []
        new_chunk_id = len(self.documents) if self.documents else 0
        
        for result in successful_results:
            # Chunk the content
            chunks = self._chunker(result.markdown)
            
            if not chunks:
                continue
            
            # Create document metadata
            doc_id = f"doc_{len(self.documents)}_{int(time.time())}"
            url_docs = self.url_index.get(result.url, [])
            
            for i, chunk in enumerate(chunks):
                chunk_id = f"{doc_id}_chunk_{i}"
                
                document = {
                    "chunk_id": chunk_id,
                    "url": result.url,
                    "title": result.metadata.get("title", ""),
                    "content": chunk,
                    "content_length": len(chunk),
                    "timestamp": datetime.now().isoformat(),
                    "metadata": {
                        "crawl_success": result.success,
                        "media_count": len(result.media.get("images", [])),
                        "links_count": len(result.links.get("internal", []) + result.links.get("external", []))
                    }
                }
                
                new_documents.append(document)
                url_docs.append(new_chunk_id + i)
                new_chunk_id += 1
                build_stats["chunks_created"] += 1
            
            self.url_index[result.url] = url_docs
        
        if not new_documents:
            return build_stats
        
        # Generate embeddings for new chunks
        chunk_texts = [doc["content"] for doc in new_documents]
        chunk_embeddings = await self._get_embeddings(chunk_texts)
        build_stats["embeddings_generated"] += len(chunk_embeddings)
        
        # Add to index
        if len(self.embeddings) == 0:
            self.embeddings = chunk_embeddings
        else:
            self.embeddings = np.vstack([self.embeddings, chunk_embeddings])
        
        start_idx = len(self.documents)
        self.documents.extend(new_documents)
        build_stats["documents_added"] += len(new_documents)
        
        # Update metadata index
        for i, doc in enumerate(new_documents):
            self.metadata_index[doc["chunk_id"]] = start_idx + i
        
        # Store if persistence enabled
        if self._storage_path:
            self._store_index()
        
        print(f"Index built: {build_stats['documents_added']} new documents, "
              f"{build_stats['chunks_created']} chunks, "
              f"total size: {len(self.documents)} documents")
        
        return build_stats
    
    async def search(
        self,
        query: str,
        top_k: int = 5,
        filters: Optional[Dict[str, Any]] = None,
        threshold: float = 0.3
    ) -> List[SearchResult]:
        """
        Perform semantic search on indexed content.
        
        Args:
            query: Search query
            top_k: Number of top results to return
            filters: Search filters (url, content_type, recency, etc.)
            threshold: Minimum similarity threshold
            
        Returns:
            List of SearchResult objects
        """
        if len(self.embeddings) == 0:
            return []
        
        # Get query embedding
        query_embedding = await get_text_embeddings([query], model_name=self.model)
        if len(query_embedding) == 0:
            return []
        
        query_emb = query_embedding[0]
        
        # Calculate similarities
        similarities = np.dot(self.embeddings, query_emb)
        top_indices = np.argsort(similarities)[::-1][:top_k * 2]  # Get extra for filtering
        
        results = []
        for idx in top_indices:
            if similarities[idx] < threshold:
                break
            
            doc = self.documents[idx]
            
            # Apply filters
            if not self._apply_filters(doc, filters):
                continue
            
            result = SearchResult(
                content=doc["content"],
                url=doc["url"],
                title=doc["title"],
                score=float(similarities[idx]),
                metadata=doc["metadata"],
                chunk_id=doc["chunk_id"]
            )
            
            results.append(result)
            
            if len(results) >= top_k:
                break
        
        return results[:top_k]
    
    def find_similar(
        self,
        reference: Union[str, Dict[str, Any]],
        threshold: float = 0.85,
        top_k: int = 5,
        url_filter: Optional[str] = None
    ) -> List[SearchResult]:
        """
        Find content similar to a reference text or document.
        
        Args:
            reference: Reference text or document dict
            threshold: Minimum similarity threshold
            top_k: Maximum number of similar items
            url_filter: Optional URL filter
            
        Returns:
            List of similar SearchResult objects
        """
        if isinstance(reference, str):
            ref_text = reference
        elif isinstance(reference, dict) and "content" in reference:
            ref_text = reference["content"]
        else:
            raise ValueError("Reference must be string or dict with 'content' key")
        
        # Use search with reference as query
        filters = {"url": url_filter} if url_filter else None
        return self.search(
            query=ref_text,
            top_k=top_k,
            filters=filters,
            threshold=threshold
        )
    
    def _apply_filters(self, document: Dict[str, Any], filters: Optional[Dict[str, Any]]) -> bool:
        """Apply search filters to a document."""
        if not filters:
            return True
        
        # URL filter
        if "url" in filters:
            if not re.search(filters["url"], document["url"], re.IGNORECASE):
                return False
        
        # Content type filter
        if "content_type" in filters:
            content_type = filters["content_type"].lower()
            doc_content = document["content"].lower()
            if content_type == "technical" and not any(term in doc_content for term in ["api", "code", "technical", "developer"]):
                return False
            elif content_type == "marketing" and not any(term in doc_content for term in ["buy", "price", "sale", "offer"]):
                return False
        
        # Recency filter
        if "recency" in filters:
            recency = filters["recency"].lower()
            try:
                timestamp = datetime.fromisoformat(document["timestamp"].replace('Z', '+00:00'))
                now = datetime.now()
                
                if recency == "recent":
                    delta = now - timestamp
                    if delta > timedelta(days=30):
                        return False
                elif recency == "6months":
                    delta = now - timestamp
                    if delta > timedelta(days=180):
                        return False
            except:
                pass  # Skip if timestamp invalid
        
        return True
    
    async def update_from_crawl_result(self, result: CrawlResult, replace: bool = False) -> Dict[str, Any]:
        """
        Update index from a single CrawlResult.
        
        Args:
            result: CrawlResult to index
            replace: Replace existing content for this URL
            
        Returns:
            Update statistics
        """
        if not result.success or not result.markdown:
            return {"added": 0, "replaced": 0, "error": "No content to index"}
        
        if replace and result.url in self.url_index:
            # Remove existing content for this URL
            existing_indices = self.url_index[result.url]
            if existing_indices:
                # Remove embeddings
                keep_mask = np.ones(len(self.embeddings), dtype=bool)
                for idx in sorted(existing_indices, reverse=True):
                    if idx < len(keep_mask):
                        keep_mask[idx] = False
                        del self.documents[idx]
                        del self.metadata_index[self.documents[idx]["chunk_id"]]
                
                self.embeddings = self.embeddings[keep_mask]
                self.documents = [d for i, d in enumerate(self.documents) if keep_mask[i]]
                
                # Update indices
                self.url_index.pop(result.url, None)
                for url, indices in self.url_index.items():
                    self.url_index[url] = [i for i in indices if keep_mask[i]]
        
        # Add new content (same as build but for single result)
        chunks = self._chunker(result.markdown)
        if not chunks:
            return {"added": 0}
        
        # Create documents
        new_documents = []
        doc_id = f"doc_{len(self.documents)}_{int(time.time())}"
        
        for i, chunk in enumerate(chunks):
            chunk_id = f"{doc_id}_chunk_{i}"
            document = {
                "chunk_id": chunk_id,
                "url": result.url,
                "title": result.metadata.get("title", ""),
                "content": chunk,
                "content_length": len(chunk),
                "timestamp": datetime.now().isoformat(),
                "metadata": {
                    "crawl_success": result.success,
                    "media_count": len(result.media.get("images", [])),
                    "links_count": len(result.links.get("internal", []) + result.links.get("external", []))
                }
            }
            new_documents.append(document)
        
        # Generate embeddings
        chunk_texts = [doc["content"] for doc in new_documents]
        chunk_embeddings = await self._get_embeddings(chunk_texts)
        
        # Add to index
        start_idx = len(self.documents)
        self.documents.extend(new_documents)
        
        if len(self.embeddings) == 0:
            self.embeddings = chunk_embeddings
        else:
            self.embeddings = np.vstack([self.embeddings, chunk_embeddings])
        
        # Update indices
        self.url_index.setdefault(result.url, []).extend(range(start_idx, len(self.documents)))
        for i, doc in enumerate(new_documents):
            self.metadata_index[doc["chunk_id"]] = start_idx + i
        
        # Store if needed
        if self._storage_path:
            self._store_index()
        
        return {
            "added": len(new_documents),
            "replaced": 1 if replace else 0,
            "total_documents": len(self.documents)
        }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get index statistics."""
        return {
            "total_documents": len(self.documents),
            "total_embeddings": len(self.embeddings),
            "embedding_dimension": self.embedding_dim,
            "indexed_urls": len(self.url_index),
            "model": self.model,
            "chunk_method": self.chunk_method,
            "storage_path": str(self._storage_path) if self._storage_path else "in-memory",
            "last_updated": datetime.now().isoformat()
        }
    
    def clear(self):
        """Clear the entire index."""
        self._reset_index()

# Example usage and integration
async def web_index_example():
    """Example demonstrating WebIndex usage."""
    # Initialize index
    index = WebIndex(
        model="sentence-transformers/all-MiniLM-L6-v2",
        chunk_method="semantic",
        storage_path="./web_index"  # Persistent storage
    )
    
    # Example URLs to index
    urls = [
        "https://example.com/docs/api-reference",
        "https://example.com/blog/oauth-guide",
        "https://example.com/features/security"
    ]
    
    async with AsyncWebCrawler() as crawler:
        # Build index
        build_result = await index.build(
            urls=urls,
            crawler=crawler,
            options={
                "chunk_method": "semantic",
                "chunk_size": 512,
                "max_concurrent": 2,
                "crawler_config": {
                    "wait_for": "networkidle"
                }
            }
        )
    
    print(f"Build complete: {build_result}")
    
    # Search the index
    search_results = await index.search(
        query="How to implement OAuth authentication?",
        top_k=5,
        filters={
            "content_type": "technical",
            "recency": "6months"
        },
        threshold=0.4
    )
    
    print(f"\nSearch Results: {len(search_results)}")
    for i, result in enumerate(search_results, 1):
        print(f"{i}. {result.title} ({result.score:.3f})")
        print(f"   URL: {result.url}")
        print(f"   Preview: {result.content[:150]}...\n")
    
    # Find similar content
    similar = index.find_similar(
        reference="OAuth 2.0 token exchange",
        threshold=0.8,
        top_k=3
    )
    
    print(f"Similar Content: {len(similar)}")
    for result in similar:
        print(f"- {result.url} ({result.score:.3f}): {result.content[:100]}...")
    
    # Get stats
    stats = index.get_stats()
    print(f"\nIndex Stats: {stats['total_documents']} documents indexed")
    
    return index, search_results, similar

# Integration with crawler workflow
async def integrated_indexing_example():
    """Example showing integration with crawling workflow."""
    async with AsyncWebCrawler() as crawler:
        # Create index
        index = WebIndex(storage_path="./my_web_index")
        
        # Crawl and index in one step
        urls = ["https://docs.example.com", "https://blog.example.com"]
        
        for url in urls:
            result = await crawler.arun(url=url)
            if result.success:
                update_result = await index.update_from_crawl_result(result)
                print(f"Indexed {url}: {update_result}")
        
        # Search
        results = await index.search("REST API authentication", top_k=3)
        print(f"Found {len(results)} relevant documents")
        
        return index