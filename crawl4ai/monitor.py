
from typing import Dict, List, Any, Optional
import asyncio
import time
import psutil
from dataclasses import dataclass
from rich.console import Console
from rich.live import Live
from rich.table import Table
from rich.panel import Panel
from rich import box
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.text import Text
import threading
from crawl4ai import AsyncWebCrawler
from crawl4ai.async_dispatcher import BaseDispatcher, MemoryAdaptiveDispatcher
from crawl4ai.models import CrawlResult

@dataclass
class MonitorMetrics:
    """Current monitoring metrics."""
    cpu_percent: float
    memory_percent: float
    memory_gb: float
    network_sent: float
    network_recv: float
    active_crawls: int
    queued_crawls: int
    completed_crawls: int
    success_rate: float
    avg_response_time: float
    pages_per_second: float
    timestamp: float

class CrawlMonitor:
    """
    Performance Monitoring System for Crawl4AI.
    
    Provides real-time insights into crawler operations, resource usage,
    and system health through CLI and GUI interfaces.
    
    Key Features:
    - Real-time resource tracking (CPU, memory, network)
    - Active crawl monitoring (progress, status)
    - Performance statistics (success rates, response times)
    - Customizable alerting system
    - Multiple display modes (CLI, GUI)
    """
    
    def __init__(
        self,
        refresh_rate: float