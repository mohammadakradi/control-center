-- Optional sign-in: the app becomes usable without an account, and signing in becomes a way to
-- keep your data private from other people using the same install.
--
-- Two things happen here.

-- 1. A reserved identity that owns everything done without signing in. `password_hash` is a
--    single '!', which `verifyPassword` can never match (it splits on ':' and bails), so this
--    row can own data but can never be signed into.
INSERT OR IGNORE INTO `users` (`id`, `email`, `password_hash`, `created_at`)
VALUES ('user_local', 'local@device', '!', unixepoch());
--> statement-breakpoint

-- 2. Upgrades only: tasks dispatched before sign-in existed have no owner, and once visibility
--    is per-owner they would belong to nobody and vanish from the UI. When this install has
--    exactly one real account, those tasks are that person's history — give them to it, so they
--    stay behind their sign-in instead of becoming visible to anyone who opens the app.
--    A fresh install has no real accounts, so the guard makes this a no-op there.
UPDATE `tasks`
SET `user_id` = (SELECT `id` FROM `users` WHERE `id` != 'user_local' LIMIT 1)
WHERE `user_id` IS NULL
  AND (SELECT COUNT(*) FROM `users` WHERE `id` != 'user_local') = 1;
