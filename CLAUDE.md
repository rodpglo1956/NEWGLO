# Avengers Relay - Multi-Bot Setup

One repo, 5 bots. Each Railway service sets BOT_ID to load a different persona.

## Bots: ava, tony, cleah, steve, carter

## Deploy Each Bot
1. New Railway service from this repo
2. Set BOT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID, SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY
3. Add /data volume at /data
4. Deploy

## Supabase
All bots share one database. Tables: messages, memory, bot_activity_log, bot_tasks, logs.
Each bot tags its data with bot_id.

## Add New Bot
1. Create config/{name}-profile.md
2. New BotFather token
3. New Railway service with BOT_ID={name}
