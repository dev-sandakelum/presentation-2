import { GridLines, Vignette } from "stagesmith";

export default function CommonBg() {
  return (
    <>
      <GridLines />
      <Vignette strength={0.32} />
    </>
  );
}
