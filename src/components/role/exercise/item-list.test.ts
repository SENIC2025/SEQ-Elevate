import { describe, it, expect } from "vitest";
import { focusAfterItemRemove, focusAfterMove, moveItem } from "./item-list";

describe("moveItem", () => {
  const list = ["a", "b", "c"];

  it("swaps an item with its neighbour", () => {
    expect(moveItem(list, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("leaves the list as it is at either end, and never changes the original", () => {
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 2, 1)).toEqual(list);
    expect(moveItem(list, 5, 1)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("focusAfterMove", () => {
  it("stays on the button pressed", () => {
    expect(focusAfterMove(2, -1, 4)).toBe("up");
    expect(focusAfterMove(1, 1, 4)).toBe("down");
  });

  it("takes the other button once the item reached the end it moved to", () => {
    expect(focusAfterMove(1, -1, 4)).toBe("down");
    expect(focusAfterMove(2, 1, 4)).toBe("up");
  });
});

describe("focusAfterItemRemove", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("goes to the item that took the removed one's place", () => {
    expect(focusAfterItemRemove(list, 0)).toBe("b");
    expect(focusAfterItemRemove(list, 1)).toBe("c");
  });
  it("goes to the one before when the last was removed", () => {
    expect(focusAfterItemRemove(list, 2)).toBe("b");
  });
  it("has nowhere to go when nothing is left", () => {
    expect(focusAfterItemRemove([{ id: "a" }], 0)).toBeNull();
  });
});
