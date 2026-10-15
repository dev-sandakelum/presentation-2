import { Aurora, GridLines } from "stagesmith";

export default function AuroraBg() {
  return (
    <>
      <Aurora colors={["#b45309", "#0d9488", "#65a30d"]} opacity={0.45} />
      <GridLines size={64} />
    </>
  );
}
