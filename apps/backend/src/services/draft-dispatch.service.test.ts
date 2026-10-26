import { describe, it, expect } from "vitest";
import { pickOpenQuestion, NEARBY_BAND } from "./draft-dispatch.service";

// Slice 10 (S10-D1): which draft, if any, counts as near a call.
describe("pickOpenQuestion", () => {
  const c = (id: string, similarity: number) => ({ id, similarity });

  it("names the nearest draft no less similar than the least similar result shown", () => {
    expect(pickOpenQuestion([c("a", 0.7), c("b", 0.8)], [0.85, 0.75])?.id).toBe("b");
    expect(pickOpenQuestion([c("a", 0.7)], [0.85, 0.75])).toBeUndefined();
  });

  it("keeps nearby relative to the best match when a shown result is far off (the verifier's -1% exemplar)", () => {
    // Shown: 0.80 and -0.01. A draft at 0.10 beats the weakest shown result
    // but is far from the call, so it is not named.
    expect(pickOpenQuestion([c("unrelated", 0.1)], [0.8, -0.01])).toBeUndefined();
    expect(pickOpenQuestion([c("near", 0.8 - NEARBY_BAND + 0.01)], [0.8, -0.01])?.id).toBe("near");
  });

  it("tolerates a hair under the floor (an identical draft scored from a halfvec copy)", () => {
    expect(pickOpenQuestion([c("same", 0.9999)], [1])?.id).toBe("same");
  });

  it("names nothing with no results shown or no candidates", () => {
    expect(pickOpenQuestion([c("a", 0.9)], [])).toBeUndefined();
    expect(pickOpenQuestion([c("a", 0.9)], [undefined])).toBeUndefined();
    expect(pickOpenQuestion([], [0.9])).toBeUndefined();
  });
});
