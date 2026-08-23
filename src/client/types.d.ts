declare module '*.css';

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}

declare module '*.mpeg' {
  const src: string;
  export default src;
}

declare module '*.mpeg?url' {
  const src: string;
  export default src;
}
