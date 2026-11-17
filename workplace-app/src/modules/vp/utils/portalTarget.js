// Where floating and off-screen elements are mounted. Every style of this module is scoped to .vp-root, so
// they must live inside it rather than directly in <body>.
export const vpPortalTarget = () => document.querySelector('.vp-root') || document.body
