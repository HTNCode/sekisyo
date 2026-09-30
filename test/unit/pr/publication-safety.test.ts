import { describe, expect, test } from "bun:test";
import { assertSafePublicationInput } from "../../../src/pr/publication-safety.ts";
import type { SekisyoPrBlock } from "../../../src/pr/marker.ts";

const baseInput = {
  attention: [],
  decisions: [],
  evidence: [],
  headOid: "a".repeat(40),
  risks: [],
  verification: []
} satisfies SekisyoPrBlock;

function withIntent(intent: string): SekisyoPrBlock {
  return { ...baseInput, intent };
}

function expectBlocked(input: SekisyoPrBlock, kind: string): void {
  expect(() => {
    assertSafePublicationInput(input);
  }).toThrow(`秘密情報の可能性がある値（${kind}）`);
}

function expectAccepted(input: SekisyoPrBlock): void {
  expect(() => {
    assertSafePublicationInput(input);
  }).not.toThrow();
}

describe("assertSafePublicationInput: headOid", () => {
  test("40桁と64桁の16進数を受け付ける", () => {
    expectAccepted({ ...baseInput, headOid: "a".repeat(40) });
    expectAccepted({ ...baseInput, headOid: "0F".repeat(32) });
  });

  test("Git object ID でない HEAD OID を拒否する", () => {
    for (const headOid of [
      "",
      "a".repeat(39),
      "a".repeat(41),
      "z".repeat(40)
    ]) {
      expect(() => {
        assertSafePublicationInput({ ...baseInput, headOid });
      }).toThrow("HEAD OID");
    }
  });
});

describe("assertSafePublicationInput: 既知の秘密情報形式", () => {
  const signatures: readonly (readonly [string, string])[] = [
    ["private key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["GitHub token", "ghp_0123456789abcdefghijklmnopqrstuvwx"],
    ["GitHub token", "github_pat_0123456789abcdefghijklmnopqrstuvwx"],
    ["OpenAI API key", "sk-0123456789abcdefghijklmnopqrstuv"],
    ["AWS access key", "AKIAQRSTUVWX01234567"],
    ["Google API key", `AIza${"0".repeat(35)}`],
    ["Slack token", "xoxb-0123456789-abcdefghij"],
    ["Stripe secret key", "sk_live_0123456789abcdefgh"],
    ["GitLab token", "glpat-0123456789abcdefghijkl"],
    ["npm token", "npm_0123456789abcdefghijklmnopqrstuv"],
    [
      "JWT",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fw"
    ],
    ["bearer token", "Bearer 0123456789abcdefghijklmnopqrstuv"],
    ["basic authorization", "Basic MDEyMzQ1Njc4OWFiY2RlZg=="]
  ];

  for (const [kind, sample] of signatures) {
    test(`${kind} を検出する: ${sample.slice(0, 16)}`, () => {
      expectBlocked(withIntent(`変更点は ${sample} です`), kind);
    });
  }

  test("全角で偽装した値も NFKC 正規化して検出する", () => {
    expectBlocked(
      withIntent("ＡＫＩＡＱＲＳＴＵＶＷＸ０１２３４５６７"),
      "AWS access key"
    );
  });
});

describe("assertSafePublicationInput: URL 埋め込み資格情報", () => {
  test("パスワードを含む URL を検出する", () => {
    expectBlocked(
      withIntent("接続先は https://admin:realpassword123@db.example.com です"),
      "credential-bearing URL"
    );
  });

  test("パスワード部が伏せ字の URL は許可する", () => {
    expectAccepted(
      withIntent("接続先は https://admin:****@db.example.com です")
    );
  });

  test("資格情報を含まない URL は許可する", () => {
    expectAccepted(withIntent("参照: https://example.com/docs/setup"));
  });
});

describe("assertSafePublicationInput: 資格情報の代入", () => {
  test("引用の有無にかかわらず ASCII の代入値を検出する", () => {
    for (const intent of [
      "api_key = abcd1234efgh5678",
      'api_key = "abcd1234efgh5678"',
      "api_key = 'abcd1234efgh5678'",
      "api_key = `abcd1234efgh5678`",
      "password: hunter2xyz123",
      "client_secret: abcd1234efgh5678",
      "connection_string=Server=db;Password=abcd1234",
      "SLACK_BOT_TOKEN=abcd1234efgh5678"
    ]) {
      expectBlocked(withIntent(intent), "credential assignment");
    }
  });

  test("プレースホルダの代入は許可する", () => {
    for (const intent of [
      "api_key = <redacted>",
      "api_key = [masked]",
      "api_key = ****",
      "api_key = xxx",
      "api_key = ${OPENAI_API_KEY}",
      "api_key = $OPENAI_API_KEY",
      "api_key = %OPENAI_API_KEY%",
      "api_key = process.env.OPENAI_API_KEY",
      "api_key = env.OPENAI_API_KEY",
      "token: not-set",
      "password: hashed.",
      "secret: 未設定"
    ]) {
      expectAccepted(withIntent(intent));
    }
  });

  test("値が無い言及は許可する", () => {
    expectAccepted(withIntent("api_key の取り扱いを見直しました"));
  });
});

describe("assertSafePublicationInput: 日本語散文の誤検知", () => {
  const prose: readonly string[] = [
    "token: セッション単位で発行するようにしています。",
    "secret: 環境変数から読み込む方式へ移行しました。",
    "password: ハッシュ化してから保存します。",
    "api_key = 環境変数経由で注入します"
  ];

  for (const intent of prose) {
    test(`散文を秘密情報として扱わない: ${intent}`, () => {
      expectAccepted(withIntent(intent));
    });
  }

  test("引用符で囲んだ日本語散文も許可する", () => {
    expectAccepted(withIntent('password: "ハッシュ化してから保存します"'));
  });
});

describe("assertSafePublicationInput: 散文と融合した実在の値の見逃し防止", () => {
  test("値の直後に空白なしで日本語が続いても検出する", () => {
    for (const intent of [
      "token=AbCd1234EfGh5678は無効化済みです",
      "password:Hunter2xyz789を使っていました",
      "client_secret=s3cr3tV4lu3xyz。"
    ]) {
      expectBlocked(withIntent(intent), "credential assignment");
    }
  });

  test("非 ASCII を含む引用値でも ASCII の連続を検出する", () => {
    for (const intent of [
      'password: "Pässwort123!secret"',
      'password: "секрет-Abc123xyz789"',
      'api_key = "本番: Ab12Cd34Ef56Gh78"'
    ]) {
      expectBlocked(withIntent(intent), "credential assignment");
    }
  });

  test("不可視文字を挟んだ値でも検出する", () => {
    for (const intent of [
      "password: Hunter2xyz789​",
      "password: Hunter2­xyz789",
      "api_key = Ab12Cd34Ef‍Gh78",
      "password: Hunt​er2xyz​789"
    ]) {
      expectBlocked(withIntent(intent), "credential assignment");
    }
  });

  test("空白で区切られた ASCII の値は散文中でも検出する", () => {
    expectBlocked(
      withIntent("変更後の値は password: Hunter2xyz789 です"),
      "credential assignment"
    );
  });

  // 資格情報とみなす ASCII 連続の最小長（8文字）を両側から固定する。
  // 短い側は、日本語散文に混ざる短い英数字（単位や桁数の説明）を
  // 秘密情報として扱わないための境界。
  test("8文字の ASCII 連続は検出する", () => {
    expectBlocked(
      withIntent("password: Ab12Cd34は再発行済みです"),
      "credential assignment"
    );
  });

  test("7文字以下の ASCII 連続しか含まない散文は許可する", () => {
    for (const intent of [
      "password: Ab12Cd3は再発行済みです",
      "token: 有効期限は24hです",
      "secret: 値は3文字ぶん短縮しました"
    ]) {
      expectAccepted(withIntent(intent));
    }
  });
});

describe("assertSafePublicationInput: 制御文字", () => {
  test("安全でない制御文字を拒否する", () => {
    for (const control of [
      "\u0000",
      "\u0008",
      "\u000b",
      "\u000c",
      "\u001f",
      "\u007f"
    ]) {
      expect(() => {
        assertSafePublicationInput(withIntent(`変更意図${control}です`));
      }).toThrow("安全でない制御文字");
    }
  });

  test("改行とタブは許可する", () => {
    expectAccepted(withIntent("1行目\n2行目\tメモ"));
  });
});

describe("assertSafePublicationInput: 走査対象フィールド", () => {
  const secret = "ghp_0123456789abcdefghijklmnopqrstuvwx";
  const cases: readonly (readonly [string, SekisyoPrBlock])[] = [
    ["intent", withIntent(secret)],
    [
      "attention.location",
      {
        ...baseInput,
        attention: [
          { classification: "must_read", location: secret, reason: "理由" }
        ]
      }
    ],
    [
      "attention.reason",
      {
        ...baseInput,
        attention: [
          {
            classification: "must_read",
            location: "src/a.ts:1",
            reason: secret
          }
        ]
      }
    ],
    ["decisions", { ...baseInput, decisions: [secret] }],
    ["risks", { ...baseInput, risks: [secret] }],
    ["verification", { ...baseInput, verification: [secret] }],
    ["unresolved", { ...baseInput, unresolved: [secret] }],
    [
      "evidence.category",
      {
        ...baseInput,
        evidence: [{ answer: "回答", category: secret, question: "質問" }]
      }
    ],
    [
      "evidence.question",
      {
        ...baseInput,
        evidence: [{ answer: "回答", category: "failure", question: secret }]
      }
    ],
    [
      "evidence.answer",
      {
        ...baseInput,
        evidence: [{ answer: secret, category: "failure", question: "質問" }]
      }
    ],
    [
      "reviewResolutions.finding",
      {
        ...baseInput,
        reviewResolutions: [
          { finding: secret, location: "src/a.ts:1", reason: "理由" }
        ]
      }
    ],
    [
      "reviewResolutions.location",
      {
        ...baseInput,
        reviewResolutions: [
          { finding: "指摘", location: secret, reason: "理由" }
        ]
      }
    ],
    [
      "reviewResolutions.reason",
      {
        ...baseInput,
        reviewResolutions: [
          { finding: "指摘", location: "src/a.ts:1", reason: secret }
        ]
      }
    ]
  ];

  for (const [field, input] of cases) {
    test(`${field} を走査する`, () => {
      expectBlocked(input, "GitHub token");
    });
  }

  test("秘密情報を含まない完全な入力は許可する", () => {
    expectAccepted({
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
    });
  });
});
