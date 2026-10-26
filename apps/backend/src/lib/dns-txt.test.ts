/**
 * The DNS check behind domain verification (rubric OD-M2, OD-V3, OD-V5).
 * Offline: every case injects a fake resolver.
 */
import { describe, it, expect } from "vitest";
import { checkDomainRecord, type TxtLookup } from "./dns-txt";

const RECORD = { name: "_soupnet-challenge.acme.example", value: "soupnet-domain-verification=tok" };

const answering = (answer: string[][]): TxtLookup => async () => answer;
const failing = (code: string): TxtLookup => async () => {
  throw Object.assign(new Error(code), { code });
};

describe("checkDomainRecord", () => {
  it("ORG-DOM-03: looks up the record's name and finds the exact value", async () => {
    const asked: string[] = [];
    const lookup: TxtLookup = async (name) => {
      asked.push(name);
      return [["v=spf1 -all"], [RECORD.value]];
    };
    expect(await checkDomainRecord(RECORD, lookup)).toEqual({ outcome: "found" });
    expect(asked).toEqual(["_soupnet-challenge.acme.example"]);
  });

  it("OD-V5: a record that only contains the value is absent", async () => {
    expect(await checkDomainRecord(RECORD, answering([[`x ${RECORD.value}`]]))).toEqual({ outcome: "absent" });
    expect(await checkDomainRecord(RECORD, answering([]))).toEqual({ outcome: "absent" });
  });

  it("NXDOMAIN and NODATA are absent", async () => {
    expect(await checkDomainRecord(RECORD, failing("ENOTFOUND"))).toEqual({ outcome: "absent", code: "ENOTFOUND" });
    expect(await checkDomainRecord(RECORD, failing("ENODATA"))).toEqual({ outcome: "absent", code: "ENODATA" });
  });

  it("any other failure is an error, carrying its code for the log", async () => {
    expect(await checkDomainRecord(RECORD, failing("ETIMEOUT"))).toEqual({ outcome: "error", code: "ETIMEOUT" });
    expect(await checkDomainRecord(RECORD, failing("ESERVFAIL"))).toEqual({ outcome: "error", code: "ESERVFAIL" });
    const noCode: TxtLookup = async () => {
      throw new Error("boom");
    };
    expect(await checkDomainRecord(RECORD, noCode)).toEqual({ outcome: "error", code: "unknown" });
  });

  it("refuses to look up anything but a challenge label", async () => {
    let called = false;
    const lookup: TxtLookup = async () => {
      called = true;
      return [];
    };
    expect(await checkDomainRecord({ name: "acme.example", value: RECORD.value }, lookup)).toEqual({ outcome: "error", code: "bad_record_name" });
    expect(called).toBe(false);
  });
});
