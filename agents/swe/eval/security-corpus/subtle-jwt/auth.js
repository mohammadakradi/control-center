import jwt from "jsonwebtoken";
export function getUser(token) {
  // decode does NOT verify the signature — forged tokens are accepted
  const payload = jwt.decode(token);
  return payload && payload.userId ? payload : null;
}
