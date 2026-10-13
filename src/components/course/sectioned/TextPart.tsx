import type { NarrativeBlock } from "@/lib/cms/types";
import { NarrativeBlocks } from "../NarrativeStage";

/** Text, exactly as learners see a lesson's text (the learner player's renderer). */
export function TextPart({ part }: { part: { blocks: NarrativeBlock[] } }) {
  return <NarrativeBlocks blocks={part.blocks} />;
}
