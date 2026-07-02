import { graciaPlugin } from "@gracia/web-sdk/vite-plugin";
import { defineConfig } from "vite";

// Gracia core ships optional XR/React imports. For 2D Three.js playback they are
// never executed; these virtual modules satisfy the bundler without adding deps.
function graciaOptionalPeers() {
  const peers = {
    "@preact/signals-core": `export function signal(v){return{value:v,peek:()=>v,subscribe:()=>()=>{}}}`,
    "@react-three/uikit":
      "export function Container(){return null} export function Fullscreen(){return null} export function Svg(){return null} export function Text(){return null}",
    "@pmndrs/pointer-events": "export function forwardHtmlEvents(){return()=>()=>{}}",
    "@react-three/fiber": "export function createRoot(){return{render(){},unmount(){}}}",
    react: "export function useEffect(){} export function useMemo(f){return f()} export function useReducer(_,i){return[i,()=>{}]} export function useRef(i){return{current:i}} export function useState(i){return[i,()=>{}]} export function useCallback(f){return f}",
    "react/jsx-runtime": "export function jsx(){return null} export function jsxs(){return null}"
  };

  return {
    name: "gracia-optional-peers",
    enforce: "pre",
    resolveId(id) {
      if (id in peers) return `\0gracia-peer:${id}`;
    },
    load(id) {
      if (!id.startsWith("\0gracia-peer:")) return null;
      return peers[id.slice("\0gracia-peer:".length)];
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [graciaOptionalPeers(), ...graciaPlugin({ bundle: "core", dedupe: true })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: "index.html"
    }
  }
});
