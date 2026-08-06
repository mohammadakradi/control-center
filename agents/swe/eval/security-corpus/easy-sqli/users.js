import Database from "better-sqlite3";
const db = new Database("app.db");
export function findUser(name) {
  // builds SQL by string concatenation from caller-supplied input
  return db.prepare("SELECT * FROM users WHERE name = '" + name + "'").get();
}
