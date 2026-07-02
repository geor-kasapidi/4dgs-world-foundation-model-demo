import fs from "fs";
const f = fs.readdirSync("dist/assets").find((x) => x.startsWith("index-") && x.endsWith(".js"));
const s = fs.readFileSync(`dist/assets/${f}`, "utf8");
console.log("alias:", s.includes("@gracia/web-sdk/wasm"));
const m = s.match(/["']([^"']*GraciaWebCore[^"']*)["']/g);
console.log("paths:", m?.slice(0, 5));
