import "server-only";
import { sql } from "./db";

/**
 * Slows down password guessing: at most 8 wrong passwords per address per 15 minutes,
 * and 40 in total across all addresses (so spreading guesses over many addresses doesn't help).
 */
const WINDOW = "15 minutes";
const PER_IP = 8, TOTAL = 40;

let ready = false;
async function ensure() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists login_attempts (id serial primary key, ip text not null,
    at timestamp not null default (now() at time zone 'utc'))`;
  await db`alter table login_attempts enable row level security`;
  ready = true;
}

export async function loginBlocked(ip: string): Promise<boolean> {
  await ensure();
  const db = sql();
  await db`delete from login_attempts where at < (now() at time zone 'utc') - interval '1 day'`;
  const [r] = await db`select
      count(*) filter (where ip = ${ip})::int as mine, count(*)::int as total
    from login_attempts where at >= (now() at time zone 'utc') - ${WINDOW}::interval`;
  return (r.mine as number) >= PER_IP || (r.total as number) >= TOTAL;
}

export async function recordFailure(ip: string) {
  await ensure();
  await sql()`insert into login_attempts (ip) values (${ip.slice(0, 64)})`;
}

export async function clearFailures(ip: string) {
  await ensure();
  await sql()`delete from login_attempts where ip = ${ip}`;
}
