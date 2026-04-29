# FastAPI Standards — Project Reference

## Route Rules
- All routes must have explicit response_model
- All routes must have a summary and tags for OpenAPI docs
- Group related routes using APIRouter with prefix
- Use HTTP methods correctly: GET (read), POST (create), PUT (full update), PATCH (partial), DELETE

## Authentication & Security
- All protected routes must use `Depends(get_current_user)`
- Never trust user input — always validate with Pydantic models
- Never expose internal error messages in responses
- Use environment variables for secrets — never hardcode
- Configure CORS explicitly (no wildcard `*` in production)

## Pydantic Models
- Separate schemas for input (Create/Update) and output (Response)
- Use `model_config = ConfigDict(from_attributes=True)` for ORM models
- Always set `min_length`, `max_length`, `pattern` on string fields where relevant
- Use `EmailStr` for email fields

## Database (SQLAlchemy / async)
- Always use async sessions (`AsyncSession`)
- Never do N+1 queries — use `selectinload` or `joinedload`
- Always close sessions — use dependency injection pattern
- All DB operations in a `crud/` or `repositories/` layer, not in routes

## Error Handling
- Use `HTTPException` with correct status codes
- Define custom exception handlers at app level
- Always log exceptions — never silently pass

## Async Rules
- All route functions must be `async def`
- Never call blocking I/O inside async functions — use `run_in_executor`
- Use `asyncio.gather()` for concurrent independent calls

## File Structure
```
app/
  routers/        ← APIRouter files grouped by feature
  models/         ← SQLAlchemy ORM models
  schemas/        ← Pydantic request/response models
  crud/           ← database operations
  core/           ← config, security, dependencies
  main.py         ← app factory
```
