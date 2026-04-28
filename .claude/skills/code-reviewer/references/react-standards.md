# React Standards — Project Reference

## Component Rules
- Use functional components only (no class components)
- One component per file, filename matches component name
- Use TypeScript interfaces for all props (no `any` type)
- Props interface named `<ComponentName>Props`

## Hooks Rules
- Never call hooks inside loops, conditions, or nested functions
- Custom hooks must start with `use` prefix
- useEffect must always declare its dependency array
- Avoid useEffect for data that can be derived from state

## State Management
- Keep state as local as possible
- Lift state only when 2+ sibling components need it
- Use React Query / TanStack Query for server state
- Never mutate state directly

## Performance
- Wrap expensive computations in `useMemo`
- Wrap callback functions passed as props in `useCallback`
- Wrap pure child components in `React.memo`
- Use dynamic `import()` for large components (code splitting)
- Always add `key` prop to list items — never use array index as key

## Styling
- Use Tailwind CSS utility classes
- No inline styles except for dynamic values
- No hardcoded color hex values — use Tailwind tokens

## API Calls
- All API calls go through a dedicated `services/` or `api/` folder
- Never put fetch/axios calls directly inside components
- Always handle loading and error states
- Never store sensitive tokens in localStorage — use httpOnly cookies

## File Structure
```
src/
  components/     ← reusable UI components
  pages/          ← route-level components
  hooks/          ← custom hooks
  services/       ← API call functions
  types/          ← TypeScript interfaces
  utils/          ← pure helper functions
```
