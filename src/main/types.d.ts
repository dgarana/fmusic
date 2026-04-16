// Vite's ?raw import produces a string. Declare it for the main process too
// (renderer gets this via vite/client types).

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
