// ① Claude APIを呼び出す関数
function callClaude(animeTitle, episodeNum, summary) {
  const API_KEY = PropertiesService
                    .getScriptProperties()
                    .getProperty('CLAUDE_API_KEY');

  const systemPrompt = `あなたはアニメ・漫画の考察ブロガーです。
読者はそのアニメのファンで、最新話を見終わった直後に検索してきた人です。

## 記事構成（必ずこの順番で書く）
1. タイトル（32文字以内・「考察」「解説」「伏線」を含める）
2. リード文（100文字・読者の感情に寄り添う書き出し）
3. 今話のざっくりまとめ（箇条書き3〜5点）
4. 注目シーン考察（2〜3場面・具体的に）
5. 伏線・謎ポイント（次話への期待を煽る）
6. まとめ（150文字・次話への期待で締める）

## 文体ルール
・語尾は「〜ですね」「〜でしょう」を混ぜる
・断定より「〜かもしれない」「〜と考えられる」を使う
・見出しはh2/h3タグで出力する
・全体で1200〜1500文字

## 禁止事項
・著作権に引っかかる台詞の直接引用はしない
・AIが書いた感のある表現は使わない
・「〜させていただきます」は使わない`;

  const userPrompt = `作品名：${animeTitle}
話数：第${episodeNum}話
あらすじメモ：${summary}

上記の情報をもとに考察記事を書いてください。`;

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      { role: "user", content: userPrompt }
    ]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(
    "https://api.anthropic.com/v1/messages",
    options
  );

  const result = JSON.parse(response.getContentText());
  return result.content[0].text;
}

// ② テスト実行用関数
function testGenerateArticle() {
  const article = callClaude(
    "葬送のフリーレン",  // 作品名
    "28",               // 話数
    "一級魔法使い試験の最終局面。フリーレンがシュタルクの成長を見守る場面が感動的だった" // あらすじメモ
  );
  
  Logger.log(article);
}

function fetchLatestAnime() {
  const RSS_URLS = [
    // アニメ情報
    "https://donanetwork.jp/category/tv-anime-broadcast-information/feed",
    "https://donanetwork.jp/category/infoanime/feed",
    // 漫画情報（追加）
    "https://donanetwork.jp/category/anime-and-comic-information/feed",
    "https://natalie.mu/comic/feed/news",
    "https://comic.natalie.mu/feed/"
  ];
  
  for (let i = 0; i < RSS_URLS.length; i++) {
    try {
      Logger.log("試行中：" + RSS_URLS[i]);
      
      const response = UrlFetchApp.fetch(RSS_URLS[i], {
        muteHttpExceptions: true
      });
      
      const statusCode = response.getResponseCode();
      Logger.log("ステータスコード：" + statusCode);
      
      if (statusCode !== 200) {
        Logger.log("スキップ：" + RSS_URLS[i]);
        continue;
      }
      
      const xml = response.getContentText();
      Logger.log("取得文字数：" + xml.length);
      
      const document = XmlService.parse(xml);
      const root = document.getRootElement();
      const channel = root.getChild("channel");
      const items = channel.getChildren("item");
      
      Logger.log("記事数：" + items.length + "件");
      
      const animeList = [];
      items.forEach(function(item) {
        const title = item.getChildText("title");
        const description = item.getChildText("description");
        const pubDate = item.getChildText("pubDate");
        const link = item.getChildText("link");
        
        animeList.push({
          title: title,
          summary: description ? description.substring(0, 200) : "",
          pubDate: pubDate,
          link: link
        });
      });
      
      if (animeList.length > 0) {
        Logger.log("成功：" + RSS_URLS[i]);
        return animeList;
      }
      
    } catch(e) {
      Logger.log("エラー：" + RSS_URLS[i] + " → " + e.message);
    }
  }
  
  return [];
}

// ④ RSS取得のテスト関数
function testFetchRSS() {
  const animeList = fetchLatestAnime();
  
  if (animeList.length === 0) {
    Logger.log("該当記事なし");
    return;
  }
  
  Logger.log("取得件数：" + animeList.length + "件");
  animeList.forEach(function(anime, index) {
    Logger.log("---" + (index + 1) + "件目---");
    Logger.log("タイトル：" + anime.title);
    Logger.log("概要：" + anime.summary);
    Logger.log("日付：" + anime.pubDate);
  });
}

// ⑤ RSS取得 → Claude生成を一括実行する関数
function generateArticlesFromRSS() {
  const animeList = fetchLatestAnimeWithRecovery();
  
  if (animeList.length === 0) {
    Logger.log("アニメ情報が取得できませんでした");
    return;
  }
  
  // 最新5件だけ記事生成（API費用節約）
  const targets = animeList.slice(0, 5);
  
  targets.forEach(function(anime, index) {
    Logger.log("=== " + (index + 1) + "件目の記事生成開始 ===");
    Logger.log("対象：" + anime.title);
    
    // HTMLタグを除去してClaudeに渡す
    const cleanSummary = anime.summary
      .replace(/<[^>]*>/g, "")
      .trim();
    
    const article = callClaude(
      anime.title,
      "最新情報",
      cleanSummary
    );
    
    Logger.log("--- 生成記事 ---");
    Logger.log(article);
    Logger.log("--- ここまで ---");
    
    // API連続呼び出しの間隔を空ける
    Utilities.sleep(2000);
  });
  
  Logger.log("全記事生成完了！");
}

// ⑥ RSSのURLをClaudeに自動で探させる関数
function findNewRssUrlByClaude() {
  const API_KEY = PropertiesService
                    .getScriptProperties()
                    .getProperty('CLAUDE_API_KEY');

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `日本の最新アニメニュースを配信している、
現在有効なRSSフィードのURLを3つ教えてください。

条件：
・2024年以降も更新されているサイト
・XMLフォーマットのRSSであること
・URLのみをJSON配列で返してください

例：["https://example.com/rss.xml", "https://example2.com/feed"]

JSONのみ返してください。説明文は不要です。`
    }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload)
  };

  try {
    const response = UrlFetchApp.fetch(
      "https://api.anthropic.com/v1/messages",
      options
    );
    const result = JSON.parse(response.getContentText());
    const text = result.content[0].text.trim();
    const urls = JSON.parse(text);
    Logger.log("Claudeが提案したURL：" + JSON.stringify(urls));
    return urls;
  } catch(e) {
    Logger.log("Claude URL検索エラー：" + e.message);
    return [];
  }
}

// ⑦ エラー時にメール通知する関数
function sendErrorNotification(message) {
  const email = Session.getActiveUser().getEmail();
  GmailApp.sendEmail(
    email,
    "【アニメブログ自動化】RSSエラー通知",
    `以下のエラーが発生しました。\n\n${message}\n\n自動復旧を試みましたが解決できませんでした。\nRSSのURLを手動で確認してください。`
  );
  Logger.log("エラーメール送信完了：" + email);
}

// ⑧ RSS自動復旧機能付きの取得関数（fetchLatestAnimeを置き換え）
function fetchLatestAnimeWithRecovery() {
  // まず通常のRSS取得を試みる
  const result = fetchLatestAnime();
  
  if (result.length > 0) {
    return result; // 成功したらそのまま返す
  }
  
  // 全URL失敗 → Claudeに新URLを探させる
  Logger.log("全RSS失敗。Claudeに新URLを探させます...");
  const newUrls = findNewRssUrlByClaude();
  
  if (newUrls.length === 0) {
    // Claudeも失敗 → メール通知
    sendErrorNotification(
      "RSSの全URLが失敗し、Claudeによる自動復旧も失敗しました。"
    );
    return [];
  }
  
  // Claudeが提案したURLで再試行
  for (let i = 0; i < newUrls.length; i++) {
    try {
      Logger.log("Claude提案URL試行中：" + newUrls[i]);
      const response = UrlFetchApp.fetch(newUrls[i], {
        muteHttpExceptions: true
      });
      
      if (response.getResponseCode() !== 200) continue;
      
      const xml = response.getContentText();
      const document = XmlService.parse(xml);
      const root = document.getRootElement();
      const channel = root.getChild("channel");
      const items = channel.getChildren("item");
      
      if (items.length > 0) {
        // 成功したURLをスクリプトプロパティに保存
        PropertiesService.getScriptProperties()
          .setProperty('RSS_URL_RECOVERED', newUrls[i]);
        
        Logger.log("自動復旧成功：" + newUrls[i]);
        
        return items.map(function(item) {
          return {
            title: item.getChildText("title"),
            summary: (item.getChildText("description") || "")
                       .substring(0, 200),
            pubDate: item.getChildText("pubDate"),
            link: item.getChildText("link")
          };
        });
      }
    } catch(e) {
      Logger.log("失敗：" + newUrls[i] + " → " + e.message);
    }
  }
  
  // 全部ダメだったらメール通知
  sendErrorNotification(
    "RSSの全URLが失敗しました。\n" +
    "Claudeが提案したURL：\n" + newUrls.join("\n") + 
    "\n\nも全て失敗しました。手動でURLを確認してください。"
  );
  
  return [];
}

// ⑨ 漫画記事を生成する関数
function callClaudeManga(mangaTitle, summary) {
  const API_KEY = PropertiesService
                    .getScriptProperties()
                    .getProperty('CLAUDE_API_KEY');

  const systemPrompt = `あなたは漫画の考察・レビューブロガーです。
読者はその漫画のファンで、最新話を読んだ直後に検索してきた人です。

## 記事構成（必ずこの順番で書く）
1. タイトル（32文字以内・「考察」「解説」「伏線」「感想」を含める）
2. リード文（100文字・読者の感情に寄り添う書き出し）
3. 最新情報のざっくりまとめ（箇条書き3〜5点）
4. 注目ポイント考察（2〜3点・具体的に）
5. 伏線・謎ポイント（続きへの期待を煽る）
6. まとめ（150文字・次の展開への期待で締める）

## 文体ルール
・語尾は「〜ですね」「〜でしょう」を混ぜる
・断定より「〜かもしれない」「〜と考えられる」を使う
・見出しはh2/h3タグで出力する
・全体で1200〜1500文字

## 禁止事項
・著作権に引っかかる台詞の直接引用はしない
・AIが書いた感のある表現は使わない
・「〜させていただきます」は使わない`;

  const userPrompt = `作品名：${mangaTitle}
情報：${summary}

上記の情報をもとに考察・レビュー記事を書いてください。`;

  const payload = {
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(
    "https://api.anthropic.com/v1/messages",
    options
  );
  const result = JSON.parse(response.getContentText());
  return result.content[0].text;
}

function generateAllArticles() {
  Logger.log("=== アニメ記事生成開始 ===");
  const animeList = fetchLatestAnimeWithRecovery();
  
  // ジャンルフィルタをかける
  const filteredAnime = filterByGenre(animeList);
  const animeTargets = filteredAnime.slice(0, 5);
  
  if (animeTargets.length === 0) {
    Logger.log("該当するアニメ記事なし");
  } else {
    animeTargets.forEach(function(anime, index) {
      Logger.log("アニメ " + (index + 1) + "件目：" + anime.title);
      const cleanSummary = anime.summary.replace(/<[^>]*>/g, "").trim();
      const article = callClaude(anime.title, "最新情報", cleanSummary);
      Logger.log(article);
      Utilities.sleep(2000);
    });
  }

  Logger.log("=== 漫画記事生成開始 ===");
  const mangaList = fetchLatestManga();
  
  // 漫画にも同じジャンルフィルタをかける
  const filteredManga = filterByGenre(mangaList);
  const mangaTargets = filteredManga.slice(0, 5);
  
  if (mangaTargets.length === 0) {
    Logger.log("該当する漫画記事なし");
  } else {
    mangaTargets.forEach(function(manga, index) {
      Logger.log("漫画 " + (index + 1) + "件目：" + manga.title);
      const cleanSummary = manga.summary.replace(/<[^>]*>/g, "").trim();
      const article = callClaudeManga(manga.title, cleanSummary);
      Logger.log(article);
      Utilities.sleep(2000);
    });
  }

  Logger.log("=== 全記事生成完了！ ===");
}

// ⑪ 漫画専用RSS取得関数
function fetchLatestManga() {
  const RSS_URLS = [
    "https://donanetwork.jp/category/anime-and-comic-information/feed",
    "https://natalie.mu/comic/feed/news"
  ];
  
  for (let i = 0; i < RSS_URLS.length; i++) {
    try {
      const response = UrlFetchApp.fetch(RSS_URLS[i], {
        muteHttpExceptions: true
      });
      if (response.getResponseCode() !== 200) continue;
      
      const xml = response.getContentText();
      const document = XmlService.parse(xml);
      const root = document.getRootElement();
      const channel = root.getChild("channel");
      const items = channel.getChildren("item");
      
      if (items.length > 0) {
        Logger.log("漫画RSS成功：" + RSS_URLS[i]);
        return items.map(function(item) {
          return {
            title: item.getChildText("title"),
            summary: (item.getChildText("description") || "")
                       .substring(0, 200),
            pubDate: item.getChildText("pubDate"),
            link: item.getChildText("link")
          };
        });
      }
    } catch(e) {
      Logger.log("漫画RSSエラー：" + e.message);
    }
  }
  return [];
}

// スプレッドシートからONのジャンル・キーワードを取得
function getActiveGenres() {
  const SS_ID = "141tleCwlMGBaEi6ST_ARzFiOqefPwZHvmHiZnJw09is";
  const sheet = SpreadsheetApp
                  .openById(SS_ID)
                  .getSheetByName("設定");
  const rows = sheet.getDataRange().getValues();
  
  const activeKeywords = [];
  
  // 1行目はヘッダーなのでスキップ（i=1から開始）
  for (let i = 1; i < rows.length; i++) {
    const genreName = rows[i][0];  // A列：ジャンル名
    const isActive  = rows[i][1];  // B列：チェックボックス
    const keywords  = rows[i][2];  // C列：キーワード
    
    if (isActive && genreName) {
      // キーワードをカンマで分割して配列に追加
      const kwList = keywords.split("、").map(k => k.trim());
      activeKeywords.push(...kwList);
    }
  }
  
  Logger.log("有効なキーワード：" + activeKeywords.join(", "));
  return activeKeywords;
}

// キーワードでRSS記事をフィルタリング
function filterByGenre(articleList) {
  const activeKeywords = getActiveGenres();
  
  // キーワードが1つも設定されていない場合は全件返す
  if (activeKeywords.length === 0) {
    Logger.log("有効ジャンルなし→全件返します");
    return articleList;
  }
  
  const filtered = articleList.filter(function(article) {
    return activeKeywords.some(function(keyword) {
      return article.title.includes(keyword) || 
             article.summary.includes(keyword);
    });
  });
  
  Logger.log("フィルタ後：" + filtered.length + "件");
  return filtered;
}