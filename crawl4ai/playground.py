import streamlit as st
import asyncio
import json
from typing import Dict, Any, Optional
import streamlit_ace as ace
from crawl4ai import AsyncWebCrawler
from crawl4ai.async_configs import CrawlerRunConfig
from crawl4ai.schema import SchemaGenerator
from crawl4ai.agents import CrawlerAgent
from crawl4ai.extraction_strategy import JsonCssExtractionStrategy
from crawl4ai.models import CrawlResult
import time

# Page config
st.set_page_config(
    page_title="Crawl4AI Playground",
    page_icon="🕷️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for better styling
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        color: #1f77b4;
        text-align: center;
        margin-bottom: 2rem;
    }
    .section-header {
        font-size: 1.5rem;
        color: #ff7f0e;
        margin-top: 2rem;
        border-bottom: 2px solid #ff7f0e;
        padding-bottom: 0.5rem;
    }
    .stButton > button {
        background-color: #1f77b4;
        color: white;
        border-radius: 0.5rem;
        border: none;
        padding: 0.5rem 1rem;
    }
    .stButton > button:hover {
        background-color: #0f4d7a;
    }
</style>
""", unsafe_allow_html=True)

class Playground:
    """Crawl4AI Playground - Interactive Web Scraping Development Environment"""
    
    def __init__(self):
        self.crawler = None
        self.session_state = {
            "results": [],
            "projects": {},
            "current_project": None,
            "ai_assistant_visible": False
        }
    
    async def initialize_crawler(self):
        """Initialize the AsyncWebCrawler."""
        if self.crawler is None:
            self.crawler = AsyncWebCrawler()
            await self.crawler.start()
    
    def sidebar(self):
        """Render the sidebar with navigation and controls."""
        st.sidebar.title("🕷️ Crawl4AI Playground")
        
        # Navigation
        page = st.sidebar.selectbox(
            "Choose a tool:",
            ["Quick Crawl", "Strategy Builder", "AI Assistant", "Project Manager", "Deployment"]
        )
        
        # Quick settings
        st.sidebar.subheader("Quick Settings")
        browser_type = st.sidebar.selectbox("Browser", ["chromium", "firefox"], index=0)
        headless = st.sidebar.checkbox("Headless", value=True)
        cache_mode = st.sidebar.selectbox("Cache", ["bypass", "use", "enabled"], index=0)
        
        # Advanced options
        with st.sidebar.expander("Advanced Options"):
            user_agent = st.text_input("User Agent", value="")
            wait_for = st.selectbox("Wait For", ["networkidle", "domcontentloaded", "load"], index=0)
            timeout = st.number_input("Timeout (s)", value=30, min_value=5)
        
        return page, {
            "browser_type": browser_type,
            "headless": headless,
            "cache_mode": cache_mode,
            "user_agent": user_agent,
            "wait_for": wait_for,
            "timeout": timeout
        }
    
    def quick_crawl_page(self, config: Dict[str, Any]):
        """Quick crawl interface."""
        st.markdown('<h1 class="main-header">⚡ Quick Crawl</h1>', unsafe_allow_html=True)
        
        col1, col2 = st.columns([3, 1])
        
        with col1:
            url = st.text_input("Enter URL to crawl:", value="https://example.com")
        
        with col2:
            st.markdown("### Crawl Options")
            screenshot = st.checkbox("Screenshot")
            pdf = st.checkbox("PDF")
            css_selector = st.text_input("CSS Selector (optional):")
        
        if st.button("🚀 Start Crawl", type="primary"):
            if not url:
                st.error("Please enter a URL")
                return
            
            with st.spinner("Crawling..."):
                try:
                    # Create config
                    run_config = CrawlerRunConfig(
                        cache_mode=config["cache_mode"],
                        screenshot=screenshot,
                        pdf=pdf,
                        css_selector=css_selector,
                        user_agent=config["user_agent"],
                        wait_for=config["wait_for"],
                        timeout=config["timeout"]
                    )
                    
                    # Run crawl
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    result = loop.run_until_complete(
                        self.crawler.arun(url=url, config=run_config)
                    )
                    
                    # Display results
                    self.display_crawl_result(result, url)
                    
                    # Store in session
                    self.session_state["results"].append({
                        "url": url,
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "result": result.model_dump()
                    })
                    
                except Exception as e:
                    st.error(f"Crawl failed: {str(e)}")
    
    def strategy_builder_page(self, config: Dict[str, Any]):
        """Visual strategy builder interface."""
        st.markdown('<h1 class="main-header">🎨 Strategy Builder</h1>', unsafe_allow_html=True)
        
        tab1, tab2, tab3 = st.tabs(["Visual Builder", "JSON Editor", "Test Strategy"])
        
        with tab1:
            st.markdown('<h3 class="section-header">Visual Strategy Builder</h3>', unsafe_allow_html=True)
            
            # Strategy components
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("Extraction Strategy")
                strategy_type = st.selectbox("Strategy Type", 
                                           ["JsonCss", "LLM", "Simple Text", "Custom"])
                
                if strategy_type == "JsonCss":
                    # Base selector
                    base_selector = st.text_input("Base Selector", value="article, .post")
                    
                    # Add fields
                    st.subheader("Fields")
                    fields = []
                    field_count = st.number_input("Number of fields", min_value=1, max_value=10, value=3)
                    
                    for i in range(int(field_count)):
                        with st.expander(f"Field {i+1}"):
                            name = st.text_input(f"Field Name {i+1}", value=f"field_{i+1}")
                            selector = st.text_input(f"CSS Selector {i+1}", value="h1.title")
                            field_type = st.selectbox(f"Type {i+1}", ["text", "attribute", "html"])
                            if field_type == "attribute":
                                attr = st.text_input(f"Attribute {i+1}", value="src")
                            
                            multiple = st.checkbox(f"Multiple values {i+1}", value=False)
                            fields.append({
                                "name": name,
                                "selector": selector,
                                "type": field_type,
                                "multiple": multiple,
                                "attribute": attr if field_type == "attribute" else None
                            })
                
                elif strategy_type == "LLM":
                    prompt = st.text_area("LLM Extraction Prompt", 
                                        value="Extract the following information as JSON: title, author, date, content")
            
            with col2:
                st.subheader("Preview")
                if st.button("Generate Preview Schema"):
                    schema = {
                        "name": "Visual Strategy",
                        "baseSelector": base_selector,
                        "fields": fields
                    }
                    st.json(schema)
        
        with tab2:
            st.markdown('<h3 class="section-header">JSON Strategy Editor</h3>', unsafe_allow_html=True)
            
            # JSON editor using ace
            schema_json = st.text_area("Edit JSON Schema", height=400, 
                                     value='{"name": "Custom Strategy", "baseSelector": "body", "fields": []}')
            
            if st.button("Validate JSON"):
                try:
                    parsed = json.loads(schema_json)
                    st.success("Valid JSON!")
                    st.json(parsed)
                except json.JSONDecodeError as e:
                    st.error(f"Invalid JSON: {str(e)}")
            
            # Ace editor for better experience
            if st.button("Open Advanced Editor"):
                st.components.v1.html(
                    f"""
                    <div id="editor"></div>
                    <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ace.js"></script>
                    <script>
                        var editor = ace.edit("editor");
                        editor.setTheme("ace/theme/monokai");
                        editor.session.setMode("ace/mode/json");
                        editor.setValue({json.dumps(schema_json)}, -1);
                    </script>
                    """,
                    height=400
                )
        
        with tab3:
            st.markdown('<h3 class="section-header">Test Strategy</h3>', unsafe_allow_html=True)
            
            test_url = st.text_input("Test URL", value="https://example.com")
            
            if st.button("Test Strategy"):
                try:
                    # Parse schema
                    schema_data = json.loads(schema_json)
                    
                    # Create strategy
                    strategy = JsonCssExtractionStrategy(**schema_data)
                    
                    # Test crawl
                    config = CrawlerRunConfig(extraction_strategy=strategy)
                    
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    result = loop.run_until_complete(
                        self.crawler.arun(url=test_url, config=config)
                    )
                    
                    if result.extracted_content:
                        st.success("Extraction successful!")
                        st.json(json.loads(result.extracted_content))
                    else:
                        st.warning("No data extracted")
                        
                except Exception as e:
                    st.error(f"Test failed: {str(e)}")
    
    def ai_assistant_page(self, config: Dict[str, Any]):
        """AI Assistant interface."""
        st.markdown('<h1 class="main-header">🤖 AI Assistant</h1>', unsafe_allow_html=True)
        
        col1, col2 = st.columns([2, 1])
        
        with col1:
            st.subheader("Ask the AI Assistant")
            user_query = st.text_area(
                "What would you like help with?",
                placeholder="e.g., How do I extract product prices from Amazon? Suggest a CSS selector for article dates.",
                height=100
            )
            
            if st.button("Get AI Help", type="primary"):
                if user_query:
                    with st.spinner("AI thinking..."):
                        # Simple AI response simulation - integrate with actual LLM
                        responses = {
                            "css selector": "For extracting article dates, try selectors like: time, .date, .published, [datetime], .article-meta time",
                            "amazon price": "For Amazon prices, use: .a-price-whole, .priceblock, [data-asin] .a-price, span.a-price",
                            "extraction strategy": "Use JsonCssExtractionStrategy with fields like: {'name': 'price', 'selector': '.price', 'type': 'text'}",
                            "playwright": "For dynamic content, set wait_for='networkidle' and use headless=False for debugging."
                        }
                        
                        # Simple keyword matching
                        response = "I'm here to help with web scraping! "
                        
                        if "css" in user_query.lower() or "selector" in user_query.lower():
                            response += responses["css selector"]
                        elif "amazon" in user_query.lower() and "price" in user_query.lower():
                            response += responses["amazon price"]
                        elif "extraction" in user_query.lower():
                            response += responses["extraction strategy"]
                        elif "dynamic" in user_query.lower() or "javascript" in user_query.lower():
                            response += responses["playwright"]
                        else:
                            response += "Try asking about CSS selectors, extraction strategies, or specific website patterns!"
                        
                        st.info(response)
                else:
                    st.warning("Please enter a question!")
        
        with col2:
            st.subheader("Quick Tips")
            tips = [
                "💡 Use specific CSS selectors like .class or #id",
                "🔍 For dynamic content, try wait_for='networkidle'",
                "📱 Test on mobile viewports for responsive sites",
                "⚙️ Cache mode 'bypass' for fresh content",
                "🛠️ Use headless=False for visual debugging"
            ]
            
            for tip in tips:
                st.info(tip)
    
    def project_manager_page(self, config: Dict[str, Any]):
        """Project management interface."""
        st.markdown('<h1 class="main-header">📁 Project Manager</h1>', unsafe_allow_html=True)
        
        # Project tabs
        tab1, tab2, tab3 = st.tabs(["My Projects", "New Project", "Templates"])
        
        with tab1:
            st.subheader("Saved Projects")
            
            if not self.session_state["projects"]:
                st.info("No projects yet. Create your first project!")
                return
            
            # Project list
            for project_name, project_data in self.session_state["projects"].items():
                with st.expander(f"📄 {project_name}"):
                    col1, col2, col3 = st.columns([3, 1, 1])
                    
                    with col1:
                        st.write(f"**Description:** {project_data.get('description', 'No description')}")
                        st.write(f"**URLs:** {len(project_data.get('urls', []))}")
                        st.write(f"**Created:** {project_data.get('created', 'Unknown')}")
                    
                    with col2:
                        if st.button(f"Run", key=f"run_{project_name}"):
                            # Run project
                            pass
                    
                    with col3:
                        if st.button("✏️ Edit", key=f"edit_{project_name}"):
                            # Edit project
                            pass
                        if st.button("🗑️ Delete", key=f"delete_{project_name}"):
                            # Delete project
                            del self.session_state["projects"][project_name]
                            st.rerun()
        
        with tab2:
            st.subheader("Create New Project")
            
            project_name = st.text_input("Project Name")
            description = st.text_area("Description")
            
            st.subheader("Add URLs")
            urls_input = st.text_area("Enter URLs (one per line)")
            urls = [url.strip() for url in urls_input.split("\n") if url.strip()]
            
            st.subheader("Configuration")
            strategy_type = st.selectbox("Extraction Strategy", ["JsonCss", "Simple", "None"])
            
            if strategy_type == "JsonCss":
                # Simple schema builder
                fields = []
                num_fields = st.number_input("Number of fields", min_value=0, max_value=10, value=0)
                for i in range(int(num_fields)):
                    with st.container():
                        col1, col2, col3 = st.columns(3)
                        with col1:
                            name = st.text_input(f"Field {i+1} Name")
                        with col2:
                            selector = st.text_input(f"Field {i+1} Selector")
                        with col3:
                            field_type = st.selectbox(f"Field {i+1} Type", ["text", "attribute"])
                        if name and selector:
                            fields.append({"name": name, "selector": selector, "type": field_type})
            
            if st.button("Create Project"):
                if project_name and urls:
                    self.session_state["projects"][project_name] = {
                        "description": description,
                        "urls": urls,
                        "strategy": {
                            "type": strategy_type,
                            "fields": fields
                        },
                        "config": config,
                        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "results": []
                    }
                    st.success(f"Project '{project_name}' created!")
                    st.rerun()
                else:
                    st.error("Please provide project name and at least one URL")
        
        with tab3:
            st.subheader("Project Templates")
            
            templates = {
                "News Scraper": {
                    "description": "Extract articles from news websites",
                    "urls": ["https://example-news.com"],
                    "strategy": {
                        "type": "JsonCss",
                        "fields": [
                            {"name": "title", "selector": "h1.title", "type": "text"},
                            {"name": "date", "selector": ".date", "type": "text"},
                            {"name": "content", "selector": ".article-body", "type": "text"}
                        ]
                    }
                },
                "Product Monitor": {
                    "description": "Track product prices and availability",
                    "urls": ["https://example-store.com/products"],
                    "strategy": {
                        "type": "JsonCss",
                        "fields": [
                            {"name": "product_name", "selector": ".product-title", "type": "text"},
                            {"name": "price", "selector": ".price", "type": "text"},
                            {"name": "stock", "selector": ".availability", "type": "text"}
                        ]
                    }
                },
                "Research Collector": {
                    "description": "Gather academic papers and articles",
                    "urls": ["https://arxiv.org/list/cs.AI/recent"],
                    "strategy": {
                        "type": "JsonCss",
                        "fields": [
                            {"name": "title", "selector": ".title", "type": "text"},
                            {"name": "authors", "selector": ".authors", "type": "text"},
                            {"name": "abstract", "selector": ".abstract", "type": "text"},
                            {"name": "pdf_url", "selector": "a[href$='.pdf']", "type": "attribute", "attribute": "href"}
                        ]
                    }
                }
            }
            
            selected_template = st.selectbox("Choose a template", list(templates.keys()))
            
            if st.button("Load Template"):
                template_data = templates[selected_template]
                st.session_state["current_project_template"] = template_data
                st.success(f"Template '{selected_template}' loaded!")
                st.rerun()
    
    def deployment_page(self, config: Dict[str, Any]):
        """Deployment pipeline interface."""
        st.markdown('<h1 class="main-header">🚀 Deployment</h1>', unsafe_allow_html=True)
        
        st.subheader("Deployment Options")
        
        col1, col2 = st.columns(2)
        
        with col1:
            st.subheader("Cloud Deployment")
            provider = st.selectbox("Cloud Provider", ["AWS", "Google Cloud", "Azure", "Docker"])
            
            if provider == "Docker":
                st.info("Docker deployment configuration")
                dockerfile_content = """
# Sample Dockerfile for Crawl4AI
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Install Playwright browsers
RUN playwright install chromium

COPY . .
EXPOSE 8000

CMD ["python", "server.py"]
                """
                st.code(dockerfile_content, language="dockerfile")
                
                if st.button("Generate Docker Files"):
                    st.download_button(
                        label="Download Dockerfile",
                        data=dockerfile_content,
                        file_name="Dockerfile",
                        mime="text/plain"
                    )
            
            elif provider == "AWS":
                st.info("AWS Lambda/EC2 deployment")
                st.write("Configure AWS deployment with:")
                st.write("- AWS Lambda for serverless")
                st.write("- EC2 for persistent instances")
                st.write("- S3 for content storage")
        
        with col2:
            st.subheader("Configuration Export")
            
            # Export current configuration
            current_config = {
                "browser_config": config,
                "crawler_settings": {
                    "cache_mode": "bypass",
                    "timeout": 30,
                    "headless": True
                },
                "extraction_strategies": [
                    {"name": "News Extractor", "type": "JsonCss", "fields": []}
                ]
            }
            
            st.json(current_config)
            
            if st.button("Export Configuration"):
                config_json = json.dumps(current_config, indent=2)
                st.download_button(
                    label="Download Config",
                    data=config_json,
                    file_name="crawl4ai_config.json",
                    mime="application/json"
                )
    
    def display_crawl_result(self, result: CrawlResult, url: str):
        """Display crawl results in a structured format."""
        if not result.success:
            st.error(f"Crawl failed: {result.error_message}")
            return
        
        # Main result tabs
        tab1, tab2, tab3, tab4 = st.tabs(["📄 Content", "🔍 Extraction", "🖼️ Media", "📊 Metadata"])
        
        with tab1:
            st.subheader(f"Content from {url}")
            
            col1, col2 = st.columns(2)
            
            with col1:
                st.markdown("### Markdown Content")
                st.text_area("Markdown", result.markdown or "", height=300, disabled=True)
            
            with col2:
                st.markdown("### Clean HTML")
                st.text_area("HTML", result.cleaned_html or "", height=300, disabled=True)
                
                st.markdown("### Word Count")
                st.metric("Words", len(result.markdown.split()) if result.markdown else 0)
                st.metric("Characters", len(result.markdown) if result.markdown else 0)
        
        with tab2:
            st.subheader("Extracted Data")
            if result.extracted_content:
                try:
                    extracted = json.loads(result.extracted_content)
                    st.json(extracted)
                except:
                    st.code(result.extracted_content, language="json")
            else:
                st.info("No structured data extracted")
        
        with tab3:
            st.subheader("Media & Assets")
            
            # Images
            if result.media and result.media.get("images"):
                st.markdown("### Images")
                for img in result.media["images"][:5]:  # Limit to 5
                    col1, col2 = st.columns(2)
                    with col1:
                        st.image(img.get("src", ""), caption=img.get("alt", ""), use_column_width=True)
                    with col2:
                        st.write(f"**Alt:** {img.get('alt', 'No alt text')}")
                        st.write(f"**Score:** {img.get('score', 'N/A')}")
            
            # Links
            if result.links:
                st.markdown("### Links")
                internal_count = len(result.links.get("internal", []))
                external_count = len(result.links.get("external", []))
                
                col1, col2 = st.columns(2)
                with col1:
                    st.metric("Internal Links", internal_count)
                with col2:
                    st.metric("External Links", external_count)
                
                if st.button("Show Sample Links"):
                    st.write("**Internal:**")
                    for link in result.links.get("internal", [])[:3]:
                        st.write(f"- [{link.get('text', 'No text')}]({link.get('href', '#')})")
                    
                    st.write("**External:**")
                    for link in result.links.get("external", [])[:3]:
                        st.write(f"- [{link.get('text', 'No text')}]({link.get('href', '#')})")
        
        with tab4:
            st.subheader("Metadata")
            st.json(result.metadata)
            
            # Performance metrics
            st.markdown("### Performance")
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Load Time", f"{result.load_time:.2f}s" if hasattr(result, 'load_time') else "N/A")
            with col2:
                st.metric("Success", "✅" if result.success else "❌")
            with col3:
                st.metric("Status Code", result.status_code or "N/A")
    
    def run(self):
        """Main playground runner."""
        # Initialize session state
        for key in self.session_state:
            if key not in st.session_state:
                st.session_state[key] = self.session_state[key]
        
        # Sidebar
        page, config = self.sidebar()
        
        # Initialize crawler
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self.initialize_crawler())
        
        # Render pages
        if page == "Quick Crawl":
            self.quick_crawl_page(config)
        elif page == "Strategy Builder":
            self.strategy_builder_page(config)
        elif page == "AI Assistant":
            self.ai_assistant_page(config)
        elif page == "Project Manager":
            self.project_manager_page(config)
        elif page == "Deployment":
            self.deployment_page(config)
        
        # Footer
        st.markdown("---")
        st.markdown("*Powered by Crawl4AI - The Open Source Web Crawling Framework*")

def main():
    """Streamlit app entry point."""
    playground = Playground()
    playground.run()

if __name__ == "__main__":
    main()