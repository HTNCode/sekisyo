import { describe, expect, test } from "bun:test";
import {
  PR_BLOCK_END,
  PR_BLOCK_START,
  renderSekisyoPrBlock,
  type SekisyoPrBlock,
  upsertSekisyoBlock
} from "../../src/pr/marker.ts";

const blockInput = {
  attention: [
    {
      classification: "must_read",
      endLine: 45,
      location: "src/cache.ts:42",
      reason: "競合制御",
      startLine: 42
    }
  ],
  decisions: ["既存APIとの互換性を維持"],
  evidence: [
    {
      answer: "失敗時は書き込みをロールバックします。",
      category: "failure",
      question: "途中で失敗した場合はどうなりますか?"
    }
  ],
  headOid: "a".repeat(40),
  intent: "キャッシュ無効化の競合を防ぐ",
  reviewResolutions: [
    {
      finding: "互換分岐が残っている",
      location: "src/cache.ts:20",
      reason: "旧クライアントの移行期間中だけ必要"
    }
  ],
  risks: ["タイムアウト"],
  unresolved: ["高負荷時の実測は未完了"],
  verification: ["bun test"]
} satisfies SekisyoPrBlock;

const block = renderSekisyoPrBlock(blockInput);

describe("Sekisyo PR marker", () => {
  test("appends a new block without replacing existing prose", () => {
    const result = upsertSekisyoBlock("Existing body", block);

    expect(result).toStartWith("Existing body");
    expect(result).toContain(PR_BLOCK_START);
    expect(result).toContain("src/cache.ts:42");
    expect(result).toContain("行範囲が判明: 4行");
    expect(result).toContain("旧クライアントの移行期間中だけ必要");
    expect(result).toContain("キャッシュ無効化の競合を防ぐ");
    expect(result).toContain("高負荷時の実測は未完了");
  });

  test("replaces only the existing marker block", () => {
    const previous = `Before\n\n${PR_BLOCK_START}\nold\n${PR_BLOCK_END}\n\nAfter`;
    const result = upsertSekisyoBlock(previous, block);

    expect(result).toStartWith("Before");
    expect(result).toEndWith("\n\nAfter");
    expect(result).not.toContain("\nold\n");
  });

  test("upsertを繰り返しても既存本文とmarker blockを増殖させない", () => {
    const first = upsertSekisyoBlock("Before\n\nAfter", block);
    const second = upsertSekisyoBlock(first, block);

    expect(second).toBe(first);
    expect(second.split(PR_BLOCK_START)).toHaveLength(2);
    expect(second.split(PR_BLOCK_END)).toHaveLength(2);
  });

  test.each([
    `${PR_BLOCK_START}\nbroken`,
    `${PR_BLOCK_END}\n${PR_BLOCK_START}`,
    `prefix ${PR_BLOCK_START}\na\n${PR_BLOCK_END}`,
    `${PR_BLOCK_START}\na\n${PR_BLOCK_END}\n${PR_BLOCK_START}\nb\n${PR_BLOCK_END}`
  ])("rejects malformed markers", (body) => {
    expect(() => upsertSekisyoBlock(body, block)).toThrow(
      "malformed Sekisyo marker"
    );
  });

  test("escapes marker text supplied as evidence", () => {
    const rendered = renderSekisyoPrBlock({
      ...blockInput,
      decisions: [`入力に ${PR_BLOCK_START} が含まれる`]
    });

    expect(rendered.split(PR_BLOCK_START)).toHaveLength(2);
    expect(rendered).toContain("&lt;!-- sekisyo:start:v1 --&gt;");
  });

  test("escapes a reserved HEAD record supplied as evidence", () => {
    const rendered = renderSekisyoPrBlock({
      ...blockInput,
      evidence: [
        {
          answer: `説明\n**対象HEAD:** \`${"b".repeat(40)}\``,
          category: "failure",
          question: "HEAD行について説明してください"
        }
      ]
    });

    expect(
      rendered.match(/^\*\*対象HEAD:\*\* `[0-9a-f]{40}`$/gmu)
    ).toHaveLength(1);
    expect(rendered).toContain("\\*\\*対象HEAD:\\*\\*");
  });

  test("公開内容のraw HTMLとmentionを無害化する", () => {
    const rendered = renderSekisyoPrBlock({
      ...blockInput,
      decisions: [
        "<details><summary>@review-team</summary>&commat;admins</details>"
      ]
    });

    expect(rendered).not.toContain("<details>");
    expect(rendered).not.toContain("@review-team");
    expect(rendered).toContain("&lt;details&gt;");
    expect(rendered).toContain("&#64;review-team");
    expect(rendered).toContain("&amp;commat;admins");
  });

  test.each([
    [
      "Q&A",
      {
        ...blockInput,
        evidence: [
          {
            answer: `OpenAI key is sk-proj-${"a".repeat(32)}`,
            category: "failure",
            question: "認証方法を説明してください"
          }
        ]
      }
    ],
    [
      "一次セルフレビュー理由",
      {
        ...blockInput,
        reviewResolutions: [
          {
            finding: "認証設定",
            location: "src/auth.ts:20",
            reason: `token = ${"A".repeat(32)}`
          }
        ]
      }
    ],
    [
      "要約",
      {
        ...blockInput,
        decisions: [`AWS key ${`AKIA${"A".repeat(16)}`}`]
      }
    ],
    [
      "JSON形式の要約",
      {
        ...blockInput,
        decisions: [
          `{"OPENAI_API_KEY": "${"not-prefixed-secret-value".repeat(2)}"}`
        ]
      }
    ],
    [
      "認証情報付きURL",
      {
        ...blockInput,
        risks: ["接続先: https://user:actual-password@example.com/database"]
      }
    ]
  ] satisfies readonly (readonly [string, SekisyoPrBlock])[])(
    "%sに秘密情報らしい値がある場合は公開前に停止する",
    (_label, input) => {
      expect(() => renderSekisyoPrBlock(input)).toThrow(
        "秘密情報の可能性がある値"
      );
    }
  );

  test("秘密情報を例外メッセージへ含めない", () => {
    const secret = `github_pat_${"Z".repeat(32)}`;

    try {
      renderSekisyoPrBlock({
        ...blockInput,
        risks: [`漏えいした値: ${secret}`]
      });
      throw new Error("Expected secret detection to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  test("明示的に伏せた値や環境変数参照は公開できる", () => {
    const rendered = renderSekisyoPrBlock({
      ...blockInput,
      decisions: [
        "api_key: <redacted>",
        "token=${GITHUB_TOKEN}",
        "password: 設定済み",
        "接続先: https://user:<redacted>@example.com/database"
      ]
    });

    expect(rendered).toContain("api_key: &lt;redacted&gt;");
    expect(rendered).toContain("token=${GITHUB_TOKEN}");
    expect(rendered).toContain("password: 設定済み");
    expect(rendered).toContain(
      "https://user:&lt;redacted&gt;&#64;example.com/database"
    );
  });

  test("invalid HEAD OIDを拒否する", () => {
    expect(() =>
      renderSekisyoPrBlock({
        ...blockInput,
        headOid: "not-an-object-id"
      })
    ).toThrow("HEAD OID");
  });
});
