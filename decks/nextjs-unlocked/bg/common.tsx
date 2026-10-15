import { GridLines, Vignette } from "stagesmith";

/** Common background for the Next.js Unlocked deck — the 88px grid. */
export default function CommonBg() {
  return (
    <>
      <GridLines size={88} />
      <Vignette strength={0.38} />
    </>
  );
}
