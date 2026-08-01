import nextConfig from "eslint-config-next"

export default [
  ...nextConfig,
  {
    // React Compiler analysis rules (bundled into eslint-config-next's
    // "recommended" since eslint-plugin-react-hooks v7) — not adopting the
    // compiler here, only classic rules-of-hooks/exhaustive-deps apply.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
    },
  },
]
