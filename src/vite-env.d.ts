/// <reference types="vite/client" />
/// <reference types="@tailwindcss/vite" />

declare module '*.css' {
  const content: string
  export default content
}