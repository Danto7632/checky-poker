# Checky Poker

**English** | [日本語](README.ja.md)

> **Work in progress — not released yet.** The address checkypoker.pages.dev currently shows a placeholder page.

Checky Poker is a free, non-commercial Texas Hold'em game that runs in the browser. You play with friends peer-to-peer: no game server, no account, no sign-up.

- **Friend tables**: invite friends with a link or a room code. The host's browser deals; cards are sealed inside a Web Worker and every player receives only their own view of the table.
- **Practice**: play against rule-based bots. Once the page has loaded, practice also works offline.
- **Bring your own key (optional)**: seat LLM bots with your own AI provider API key. The key stays in your browser and is sent only to the provider you choose; usage costs and the provider's terms are your responsibility.
- **Languages**: English and Japanese.

## No real money

Chips are play chips with no monetary value. They can never be bought, sold, transferred or cashed out. There are no prizes, and refills are free and unlimited. Checky Poker must not be used to play for real money or to keep score for real-money games, and it links to no gambling service.

## Availability

When released, the hosted app at checkypoker.pages.dev will be officially provided for **Japan, the United States and Canada**.

It is not distributed to, localized for, promoted in or supported in: the Republic of Korea, Australia, Brazil, mainland China, Indonesia, Malaysia, Mexico, Taiwan, Thailand, Vietnam, the United Arab Emirates, Saudi Arabia and Qatar. Access is not technically blocked.

Elsewhere, it is not officially supported; check your local laws. Players must be 18 or older, or the age of majority where they live if that is higher. Nothing in this repository is legal advice.

These statements cover only our hosted instance and our support. If you host your own copy, you are responsible for compliance where you operate it.

> 대한민국: 이 서비스는 대한민국을 배포·제공 대상으로 하지 않으며 공식 지원하지 않습니다.

## Development

Requirements: Node.js (the version in [`.nvmrc`](.nvmrc)) and npm.

```bash
npm ci                    # install the workspace (packages/engine, packages/analysis, frontend)
npm run dev -w frontend   # start the Vite dev server
npm test                  # run all tests
npm run build             # production build into frontend/dist
```

`backend/` holds the dormant code of AIPOT, an earlier server-based prototype from this repository's history. It is not part of Checky Poker and is not deployed.

## License

The source code is licensed under the [MIT License](LICENSE). The name "Checky Poker" and its logo are not covered by the MIT License. Third-party assets keep their own licenses; see [`frontend/ATTRIBUTIONS.md`](frontend/ATTRIBUTIONS.md).
