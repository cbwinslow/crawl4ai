from typing import List, Dict, Any, Optional, Union
import asyncio
import json
from dataclasses import dataclass
from crawl4ai import AsyncWebCrawler
from crawl4ai.async_configs import CrawlerRunConfig
from crawl4ai.models import CrawlResult
from .utils import perform_completion_with_backoff
from .config import DEFAULT_PROVIDER, PROVIDER_MODELS
import time
from enum import Enum

class AgentStepStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class AgentStep:
    """Represents a single step in the agent's execution plan."""
    step_id: str
    description: str
    action_type: str  # e.g., "crawl", "click", "extract", "validate"
    parameters: Dict[str, Any]
    status: AgentStepStatus = AgentStepStatus.PENDING
    result: Optional[Any] = None
    error: Optional[str] = None
    duration: float = 0.0
    dependencies: List[str] = None  # Step IDs this step depends on

@dataclass
class AgentExecutionResult:
    """Result of agent execution."""
    executed_steps: List[AgentStep]
    data: Dict[str, Any]  # Extracted data
    step_status: Dict[str, AgentStepStatus]
    execution_time: float
    success_rate: float  # Percentage of successful steps
    final_state: str  # "success", "partial", "failed"
    plan: List[Dict[str, Any]]  # Original plan

class CrawlerAgent:
    """
    Agentic Crawler that autonomously interprets goals, plans multi-step operations,
    and executes complex crawling tasks with error recovery and monitoring.
    
    Key Features:
    - Autonomous goal interpretation using LLM
    - Dynamic step planning and execution
    - Interactive navigation (clicks, scrolling, form filling)
    - Visual recognition and validation
    - Automatic error recovery and retry logic
    - Comprehensive monitoring and reporting
    """
    
    def __init__(
        self,
        crawler: AsyncWebCrawler,
        llm_provider: str = DEFAULT_PROVIDER,
        llm_config: Optional[Dict[str, Any]] = None,
        max_retries: int = 3,
        retry_delay: float = 2.0,
        max_steps: int = 20,
        **kwargs
    ):
        """
        Initialize the CrawlerAgent.
        
        Args:
            crawler: The AsyncWebCrawler instance to use
            llm_provider: LLM provider for planning and decision making
            llm_config: Configuration for LLM calls
            max_retries: Maximum retries for failed steps
            retry_delay: Delay between retries in seconds
            max_steps: Maximum number of steps in execution plan
            **kwargs: Additional agent configuration
        """
        self.crawler = crawler
        self.llm_provider = llm_provider
        self.llm_config = llm_config or {}
        self.api_key = self.llm_config.get('api_key') or PROVIDER_MODELS.get(llm_provider)
        if not self.api_key:
            raise ValueError(f"API key required for {llm_provider}")
        
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.max_steps = max_steps
        
        # Planning prompts
        self.planning_prompts = {
            "goal_interpretation": """
You are an expert web research agent. Given a goal, break it down into specific, actionable crawling steps.

Goal: {goal}

Analyze the goal and create a step-by-step plan. Each step should be:
1. Specific and actionable
2. Use available crawling capabilities (navigation, extraction, validation)
3. Include success criteria
4. Consider error handling

Return a JSON array of steps with:
- step_id: unique identifier
- description: human-readable description
- action_type: "crawl", "navigate", "extract", "validate", "interact"
- parameters: dictionary of parameters for the action
- dependencies: array of step_ids this step depends on (optional)

Example format:
[
  {{
    "step_id": "step1",
    "description": "Search for quantum computing papers on arXiv",
    "action_type": "crawl",
    "parameters": {{"url": "https://arxiv.org/search/?query=quantum+computing&searchtype=all&date-from_date=2023&date-to_date=&date-date_type=submitted_date&abstracts=show&order=-announced_date_first&size=50"}},
    "dependencies": []
  }}
]
            """,
            
            "error_recovery": """
A step failed: {step_description}
Error: {error}

Suggest recovery actions. Return JSON with:
- retry: boolean - should we retry the step?
- alternative_steps: array of alternative step definitions
- skip: boolean - should we skip this step and continue?
- abort: boolean - should we stop the entire plan?

Example:
{{
  "retry": true,
  "retry_params": {{"timeout": 60, "retry_count": 2}},
  "alternative_steps": [...],
  "skip": false,
  "abort": false
}}
            """,
            
            "validation": """
Validate if this content meets the step criteria: {criteria}

Content summary: {content_preview}

Return JSON:
{{
  "meets_criteria": boolean,
  "confidence": 0.0-1.0,
  "missing_elements": ["list of missing items"],
  "next_action": "continue|refine|retry|stop",
  "suggested_refinement": "optional suggestion"
}}
            """
        }
        
        # Execution state
        self.execution_history = []
        self.current_plan = []
        self.session_id = f"agent_{int(time.time())}"
    
    async def _call_llm(self, prompt: str, response_format: str = "json") -> Dict[str, Any]:
        """Make LLM call with error handling."""
        try:
            messages = [{"role": "user", "content": prompt}]
            extra_args = {
                "temperature": 0.1,
                "api_key": self.api_key,
                "max_tokens": 1500
            }
            
            if response_format == "json":
                extra_args["response_format"] = {"type": "json_object"}
            
            response = perform_completion_with_backoff(
                self.llm_provider,
                prompt,
                self.api_key,
                json_response=(response_format == "json"),
                **self.llm_config
            )
            
            if response and hasattr(response, 'choices') and response.choices:
                content = response.choices[0].message.content
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    # Try to extract JSON from response
                    json_start = content.find('{')
                    json_end = content.rfind('}') + 1
                    if json_start != -1 and json_end != -1:
                        return json.loads(content[json_start:json_end])
                    else:
                        return {"error": "Invalid JSON response", "raw": content}
            else:
                return {"error": "No response from LLM"}
                
        except Exception as e:
            return {"error": f"LLM call failed: {str(e)}"}
    
    async def plan_steps(self, goal: str, custom_plan: Optional[List[Dict[str, Any]]] = None) -> List[AgentStep]:
        """
        Generate execution plan from goal or use custom plan.
        
        Args:
            goal: Natural language goal description
            custom_plan: Optional predefined plan to execute
            
        Returns:
            List of AgentStep objects
        """
        if custom_plan:
            # Convert custom plan to AgentSteps
            steps = []
            for i, step_def in enumerate(custom_plan):
                step = AgentStep(
                    step_id=f"custom_{i+1}",
                    description=step_def.get("description", step_def.get("action", "Custom step")),
                    action_type=step_def.get("action_type", "crawl"),
                    parameters=step_def.get("parameters", {}),
                    dependencies=step_def.get("dependencies", [])
                )
                steps.append(step)
            return steps
        
        # Generate plan using LLM
        prompt = self.planning_prompts["goal_interpretation"].format(goal=goal)
        llm_response = await self._call_llm(prompt)
        
        if "error" in llm_response:
            raise ValueError(f"Planning failed: {llm_response['error']}")
        
        try:
            plan_steps = llm_response.get("steps", [])
            if not isinstance(plan_steps, list):
                plan_steps = json.loads(plan_steps) if isinstance(plan_steps, str) else []
            
            agent_steps = []
            for i, step_def in enumerate(plan_steps[:self.max_steps]):
                if not isinstance(step_def, dict):
                    continue
                
                agent_step = AgentStep(
                    step_id=step_def.get("step_id", f"step_{i+1}"),
                    description=step_def.get("description", "Generated step"),
                    action_type=step_def.get("action_type", "crawl"),
                    parameters=step_def.get("parameters", {}),
                    dependencies=step_def.get("dependencies", [])
                )
                agent_steps.append(agent_step)
            
            if not agent_steps:
                # Fallback: create basic crawling plan
                agent_steps = [
                    AgentStep(
                        step_id="step1",
                        description=f"Crawl relevant pages for goal: {goal}",
                        action_type="crawl",
                        parameters={"urls": [], "search_query": goal}
                    )
                ]
            
            return agent_steps
            
        except Exception as e:
            raise ValueError(f"Failed to parse planning response: {str(e)}")
    
    async def _execute_step(self, step: AgentStep, context: Dict[str, Any]) -> AgentStep:
        """
        Execute a single agent step.
        
        Args:
            step: The AgentStep to execute
            context: Execution context with previous results
            
        Returns:
            Updated AgentStep with execution result
        """
        start_time = time.time()
        step.status = AgentStepStatus.RUNNING
        
        try:
            if step.action_type == "crawl":
                await self._execute_crawl_step(step, context)
            elif step.action_type == "navigate":
                await self._execute_navigate_step(step, context)
            elif step.action_type == "extract":
                await self._execute_extract_step(step, context)
            elif step.action_type == "validate":
                await self._execute_validate_step(step, context)
            elif step.action_type == "interact":
                await self._execute_interact_step(step, context)
            else:
                # Default: treat as crawl
                await self._execute_crawl_step(step, context)
            
            step.status = AgentStepStatus.COMPLETED
            step.error = None
            
        except Exception as e:
            step.status = AgentStepStatus.FAILED
            step.error = str(e)
            step.result = None
        
        step.duration = time.time() - start_time
        return step
    
    async def _execute_crawl_step(self, step: AgentStep, context: Dict[str, Any]):
        """Execute a crawling action."""
        urls = step.parameters.get("urls", [])
        search_query = step.parameters.get("search_query")
        
        if search_query and not urls:
            # Use question-based discovery if available
            try:
                from .discovery import QuestionBasedDiscovery
                discovery = QuestionBasedDiscovery(self.crawler)
                discovery_results = await discovery.arun(
                    question=search_query,
                    max_urls=step.parameters.get("max_urls", 5)
                )
                urls = [r["url"] for r in discovery_results]
            except ImportError:
                # Fallback: simple crawl of search results page
                urls = [f"https://www.google.com/search?q={search_query}"]
        
        if not urls:
            raise ValueError("No URLs specified for crawl step")
        
        # Crawl URLs
        config = CrawlerRunConfig(
            cache_mode="bypass",
            verbose=False,
            **step.parameters.get("crawler_config", {})
        )
        
        results = []
        for url in urls[:3]:  # Limit to top 3 URLs
            result = await self.crawler.arun(url=url, config=config)
            if result.success:
                results.append(result)
        
        step.result = {
            "crawled_urls": urls,
            "successful_crawls": len(results),
            "results": [r.model_dump() for r in results]
        }
    
    async def _execute_navigate_step(self, step: AgentStep, context: Dict[str, Any]):
        """Execute navigation (click, scroll) actions."""
        # This would use Playwright's page interactions
        # For now, simulate with crawling
        target_url = step.parameters.get("url", context.get("current_url"))
        if not target_url:
            raise ValueError("No target URL for navigation")
        
        config = CrawlerRunConfig(
            js_code=step.parameters.get("js_code", ""),  # Execute JS for interaction
            wait_for=step.parameters.get("wait_for", "networkidle"),
            **step.parameters.get("crawler_config", {})
        )
        
        result = await self.crawler.arun(url=target_url, config=config)
        step.result = {"navigated_to": target_url, "result": result.model_dump()}
    
    async def _execute_extract_step(self, step: AgentStep, context: Dict[str, Any]):
        """Execute content extraction."""
        content = context.get("current_content")
        if not content:
            raise ValueError("No content available for extraction")
        
        extraction_strategy = step.parameters.get("extraction_strategy")
        if extraction_strategy:
            # Use JsonCssExtractionStrategy or similar
            from .extraction_strategy import JsonCssExtractionStrategy
            if isinstance(extraction_strategy, dict):
                strategy = JsonCssExtractionStrategy.from_dict(extraction_strategy)
            else:
                strategy = extraction_strategy
            
            # Extract from current content
            extracted = strategy.run(content.get("url", ""), [content.get("markdown", "")])
            step.result = {"extracted_data": extracted}
        else:
            # Default: extract all markdown
            step.result = {"extracted_data": content.get("markdown", "")}
    
    async def _execute_validate_step(self, step: AgentStep, context: Dict[str, Any]):
        """Validate step results using LLM."""
        content = context.get("current_content", {})
        criteria = step.parameters.get("criteria", "Content should be relevant to the goal")
        
        prompt = self.planning_prompts["validation"].format(
            criteria=criteria,
            content_preview=content.get("markdown", "")[:500]
        )
        
        llm_response = await self._call_llm(prompt)
        step.result = llm_response
    
    async def _execute_interact_step(self, step: AgentStep, context: Dict[str, Any]):
        """Execute interactive actions (click, fill form, etc.)."""
        # Simulate interaction with JS execution
        js_code = step.parameters.get("js_code", "")
        if not js_code:
            raise ValueError("No JavaScript code specified for interaction")
        
        target_url = step.parameters.get("url", context.get("current_url"))
        config = CrawlerRunConfig(
            js_code=js_code,
            wait_for=step.parameters.get("wait_for", "domcontentloaded"),
            **step.parameters.get("crawler_config", {})
        )
        
        result = await self.crawler.arun(url=target_url, config=config)
        step.result = {"interaction_executed": js_code, "result": result.model_dump()}
    
    async def _handle_error_recovery(self, step: AgentStep, error: str) -> bool:
        """Handle errors with LLM-based recovery."""
        prompt = self.planning_prompts["error_recovery"].format(
            step_description=step.description,
            error=error
        )
        
        llm_response = await self._call_llm(prompt)
        
        if llm_response.get("retry", False):
            # Retry the step with modified parameters
            step.parameters.update(llm_response.get("retry_params", {}))
            return True  # Retry
        
        if llm_response.get("skip", False):
            step.status = AgentStepStatus.SKIPPED
            step.error = f"Skipped: {llm_response.get('reason', 'LLM decision')}"
            return False  # Skip
        
        if llm_response.get("abort", False):
            raise RuntimeError(f"Agent aborted: {llm_response.get('reason', 'LLM decision')}")
        
        # Try alternative steps
        alternative_steps = llm_response.get("alternative_steps", [])
        if alternative_steps:
            # Replace current step with alternatives
            self.current_plan = [
                s for s in self.current_plan if s.step_id != step.step_id
            ] + [AgentStep(**alt) for alt in alternative_steps]
            return False  # Continue with new plan
        
        # Default: fail the step
        return False
    
    async def execute_plan(self, plan: List[AgentStep]) -> AgentExecutionResult:
        """
        Execute the agent plan with dependency management and error handling.
        
        Args:
            plan: List of AgentStep objects to execute
            
        Returns:
            AgentExecutionResult with execution details
        """
        self.current_plan = plan
        self.execution_history = []
        
        # Build dependency graph
        step_dependencies = {step.step_id: step.dependencies or [] for step in plan}
        ready_steps = [step for step in plan if not step.dependencies or all(dep not in step_dependencies for dep in step.dependencies)]
        
        executed_steps = []
        step_status = {}
        data = {}
        start_time = time.time()
        
        while ready_steps:
            # Execute ready steps concurrently (limit to avoid overwhelming)
            semaphore = asyncio.Semaphore(2)
            
            async def execute_ready_step(step: AgentStep) -> AgentStep:
                async with semaphore:
                    context = {"session_id": self.session_id, "previous_results": data}
                    return await self._execute_step(step, context)
            
            # Execute current batch
            tasks = [execute_ready_step(step) for step in ready_steps[:3]]  # Batch size 3
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    # Handle execution exception
                    ready_steps[i].status = AgentStepStatus.FAILED
                    ready_steps[i].error = str(result)
                    executed_steps.append(ready_steps[i])
                    continue
                
                executed_step = result
                executed_steps.append(executed_step)
                step_status[executed_step.step_id] = executed_step.status
                
                # Update data context
                if executed_step.result:
                    data[executed_step.step_id] = executed_step.result
                
                self.execution_history.append(executed_step)
            
            # Find next ready steps
            completed_step_ids = {step.step_id for step in executed_steps}
            ready_steps = []
            
            for step in plan:
                if step.step_id in completed_step_ids:
                    continue
                
                # Check if all dependencies are completed
                deps_completed = all(
                    dep in completed_step_ids 
                    for dep in step_dependencies.get(step.step_id, [])
                )
                
                if deps_completed and step not in executed_steps:
                    ready_steps.append(step)
        
        # Handle remaining unexecuted steps as failed
        for step in plan:
            if step.step_id not in step_status:
                step.status = AgentStepStatus.FAILED
                step.error = "Dependency not satisfied or plan incomplete"
                executed_steps.append(step)
                step_status[step.step_id] = step.status
        
        # Calculate metrics
        execution_time = time.time() - start_time
        total_steps = len(plan)
        successful_steps = sum(1 for s in executed_steps if s.status == AgentStepStatus.COMPLETED)
        success_rate = (successful_steps / total_steps * 100) if total_steps > 0 else 0.0
        
        # Determine final state
        if success_rate >= 80.0:
            final_state = "success"
        elif success_rate >= 50.0:
            final_state = "partial"
        else:
            final_state = "failed"
        
        # Convert plan to serializable format
        plan_serial = [
            {
                "step_id": s.step_id,
                "description": s.description,
                "action_type": s.action_type,
                "parameters": s.parameters,
                "dependencies": s.dependencies or []
            }
            for s in plan
        ]
        
        return AgentExecutionResult(
            executed_steps=executed_steps,
            data=data,
            step_status=step_status,
            execution_time=execution_time,
            success_rate=success_rate,
            final_state=final_state,
            plan=plan_serial
        )
    
    async def arun(
        self,
        goal: str,
        custom_plan: Optional[List[Dict[str, Any]]] = None,
        auto_retry: bool = True,
        max_execution_time: Optional[float] = None,
        **kwargs
    ) -> AgentExecutionResult:
        """
        Main entry point: Run agent with goal or custom plan.
        
        Args:
            goal: Natural language goal for autonomous execution
            custom_plan: Optional predefined plan (overrides goal)
            auto_retry: Enable automatic error recovery
            max_execution_time: Maximum execution time in seconds
            **kwargs: Additional execution parameters
            
        Returns:
            AgentExecutionResult with full execution details
        """
        start_time = time.time()
        
        if max_execution_time and (time.time() - start_time) > max_execution_time:
            raise TimeoutError("Execution time limit exceeded before starting")
        
        # Generate or use plan
        plan = await self.plan_steps(goal, custom_plan)
        
        print(f"🧠 Agent planning complete: {len(plan)} steps generated")
        for i, step in enumerate(plan, 1):
            print(f"  {i}. {step.description} ({step.action_type})")
        
        # Execute plan
        result = await self.execute_plan(plan)
        
        # Auto-retry logic if enabled
        retry_count = 0
        while auto_retry and result.final_state == "failed" and retry_count < self.max_retries:
            retry_count += 1
            print(f"🔄 Auto-retry {retry_count}/{self.max_retries}")
            
            # Identify failed steps and attempt recovery
            failed_steps = [s for s in result.executed_steps if s.status == AgentStepStatus.FAILED]
            
            for failed_step in failed_steps:
                if await self._handle_error_recovery(failed_step, failed_step.error):
                    # Re-execute the step
                    context = {"session_id": self.session_id, "previous_results": result.data}
                    recovered_step = await self._execute_step(failed_step, context)
                    # Update result
                    idx = result.executed_steps.index(failed_step)
                    result.executed_steps[idx] = recovered_step
            
            # Re-calculate metrics
            successful_steps = sum(1 for s in result.executed_steps if s.status == AgentStepStatus.COMPLETED)
            result.success_rate = (successful_steps / len(plan) * 100) if plan else 0.0
            
            if result.success_rate >= 80.0:
                result.final_state = "success"
                break
            elif result.success_rate >= 50.0:
                result.final_state = "partial"
                break
        
        # Add execution metadata
        result.metadata = {
            "goal": goal,
            "session_id": self.session_id,
            "total_retries": retry_count,
            "llm_provider": self.llm_provider,
            "max_steps": self.max_steps,
            "timestamp": time.time()
        }
        
        print(f"✅ Agent execution complete: {result.final_state} (Success rate: {result.success_rate:.1f}%)")
        print(f"⏱️  Total time: {result.execution_time:.2f}s")
        
        return result

# Example usage and integration
async def agentic_crawler_example():
    """Example demonstrating Agentic Crawler usage."""
    async with AsyncWebCrawler() as crawler:
        agent = CrawlerAgent(crawler)
        
        # Example 1: Autonomous goal execution
        print("=== Autonomous Goal Execution ===")
        result1 = await agent.arun(
            goal="Find research papers about quantum computing published in 2023 with more than 50 citations",
            auto_retry=True
        )
        
        print(f"Generated Plan: {len(result1.executed_steps)} steps")
        print(f"Extracted Data: {len(result1.data)} items")
        print(f"Success Rate: {result1.success_rate:.1f}%")
        
        # Example 2: Custom plan execution
        print("\n=== Custom Plan Execution ===")
        custom_plan = [
            {
                "step_id": "step1",
                "description": "Navigate to ML conference listing",
                "action_type": "crawl",
                "parameters": {
                    "urls": ["https://neurips.cc/Conferences/2024/Dates"],
                    "crawler_config": {"wait_for": "networkidle"}
                }
            },
            {
                "step_id": "step2", 
                "description": "Extract important dates section",
                "action_type": "extract",
                "parameters": {
                    "extraction_strategy": {
                        "name": "Important Dates",
                        "baseSelector": ".dates-container",
                        "fields": [
                            {"name": "submission_deadline", "selector": ".submission", "type": "text"},
                            {"name": "notification_date", "selector": ".notification", "type": "text"},
                            {"name": "conference_date", "selector": ".conference", "type": "text"}
                        ]
                    }
                },
                "dependencies": ["step1"]
            },
            {
                "step_id": "step3",
                "description": "Validate dates are for 2024",
                "action_type": "validate",
                "parameters": {
                    "criteria": "All dates should be in 2024 or later"
                },
                "dependencies": ["step2"]
            }
        ]
        
        result2 = await agent.arun(
            goal="Extract NeurIPS 2024 deadlines",  # Still needed for context
            custom_plan=custom_plan,
            auto_retry=True
        )
        
        print(f"Custom Plan Execution: {result2.final_state}")
        print(f"Step Status: {dict(result2.step_status)}")
        print(f"Execution Time: {result2.execution_time:.2f}s")
        
        return result1, result2