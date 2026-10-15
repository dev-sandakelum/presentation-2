import { formatTsx } from "../src/lib/stagesmith/format";

const minified = `export default function Slide() {  return (    <section className="slide s-title">      <div className="title-wrap">        <h1 className="title">Next.js Unlocked</h1>        <p className="title-sub">From React library to full-stack framework.</p>      </div>    </section>  );}`;

const broken = `export default function Slide() { return <section>; `;

const formatted = await formatTsx(minified);
const lines = formatted.split("\n");
console.log("formatted lines:", lines.length);
console.log("first:", JSON.stringify(lines[0]));
console.log("second:", JSON.stringify(lines[1]));
console.log("multi-line & indented:", lines.length > 6 && /^ {2}</.test(lines[1] ?? ""));
const out2 = await formatTsx(broken);
console.log("broken passthrough unchanged:", out2 === broken);
console.log("idempotent:", (await formatTsx(formatted)) === formatted);
