import { readFileSync } from "node:fs";
const load = (name) => JSON.parse(readFileSync(new URL(`../site/data/${name}.json`, import.meta.url), "utf8"));
export const rules = load("rules");
export const policy = load("policy");
export const holidays = load("holidays").dates;
export const golden = load("golden_set");
export const seed = load("seed");
export const samples = load("policy_samples").samples;
export const people = seed.people;
