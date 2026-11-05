// Unit check for the Supabase pooler rewrite (run: node tests/db-url.test.mjs).
import assert from "node:assert/strict";

const rewrite = (url) => url.replace(/(@[^/]*\.pooler\.supabase\.com):5432(\/|$)/, "$1:6543$2");
assert.equal(rewrite("postgresql://postgres.abc:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"),
  "postgresql://postgres.abc:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres");
assert.equal(rewrite("postgresql://postgres.abc:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"),
  "postgresql://postgres.abc:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres");
assert.equal(rewrite("postgresql://postgres:pw@localhost:5432/e2e"), "postgresql://postgres:pw@localhost:5432/e2e");
assert.equal(rewrite("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres"), "postgresql://postgres:pw@db.abc.supabase.co:5432/postgres");
console.log("db-url rewrite: all checks passed");
