# The Avengers - Kaldr Tech Bot Fleet

5-bot fleet powered by Claude Code CLI. One repo, multiple Railway services.

```
Telegram → grammY → relay.ts → Claude Code CLI → Response
                                     │
                               Supabase (shared memory)
```

## The Roster

| Bot | Codename | Role | BOT_ID |
|-----|----------|------|--------|
| Ava | - | Chief of Staff - calendar, email, coordination | ava |
| Tony | Iron Man | Revenue Engine - sales, leads, partnerships | tony |
| Cleah | Vision | CTO / Build Ops - 19-product portfolio, dev tracking | cleah |
| Steve | Captain America | Ops & Intel - monitoring, finances, market intel | steve |
| Carter | Agent Carter | Content & Launch - social media, campaigns, assets | carter |

## How It Works

Same code runs for every bot. The `BOT_ID` env var determines which profile loads from `config/{bot_id}-profile.md`. Each bot gets its own Telegram token and Railway service.

## Deploy a Bot

1. Create a Telegram bot via @BotFather
2. Create a new Railway service pointing to this repo
3. Set environment variables:
   - `BOT_ID` = ava (or tony, cleah, steve, carter)
   - `TELEGRAM_BOT_TOKEN` = token from BotFather
   - `TELEGRAM_USER_ID` = 6269428527
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_ANON_KEY` = your anon key
   - `ANTHROPIC_API_KEY` = from console.anthropic.com
4. Add /data volume
5. Deploy

## Add a New Bot

1. Create `config/{name}-profile.md`
2. Create Telegram bot via @BotFather
3. Deploy new Railway service with `BOT_ID={name}`

## Structure

```
config/
  ava-profile.md       Chief of Staff
  tony-profile.md      Revenue Engine
  cleah-profile.md     CTO / Build Ops
  steve-profile.md     Ops & Intel
  carter-profile.md    Content & Launch
src/
  relay.ts             Core daemon (shared)
  memory.ts            Supabase memory
  transcribe.ts        Voice transcription
db/
  schema.sql           Database tables
Dockerfile             Railway container
```
