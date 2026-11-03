import { describe, it, expect } from "vitest";
import { LIST_MAX_LIMIT, parseListPaging } from "./list-paging";

describe("parseListPaging", () => {
  it("defaults what's absent and caps a large limit", () => {
    expect(parseListPaging({})).toEqual({ limit: 50, offset: 0 });
    expect(parseListPaging({ limit: "10", offset: "20" })).toEqual({ limit: 10, offset: 20 });
    expect(parseListPaging({ limit: "100000" })).toEqual({ limit: LIST_MAX_LIMIT, offset: 0 });
  });

  it("refuses anything that isn't a page", () => {
    for (const query of [
      { limit: "-1" },
      { limit: "0" },
      { limit: "abc" },
      { limit: "" },
      { limit: "1.5" },
      { limit: "1e3" },
      { offset: "-1" },
      { offset: "abc" },
      { offset: "99999999999999999999" },
      { offset: "2147483648" },
    ]) {
      expect(parseListPaging(query), JSON.stringify(query)).toBeNull();
    }
  });
});
