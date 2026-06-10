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
      if (isDuplicateArticle(anime.title)) {
        Logger.log("スキップ（重複）：" + anime.title);
        return;
      }
      Logger.log("アニメ " + (index + 1) + "件目：" + anime.title);
      const cleanSummary = anime.summary.replace(/<[^>]*>/g, "").trim();
      const articleContent = callClaude(anime.title, "最新情報", cleanSummary);
      const wpTitle = extractArticleTitle(articleContent) || anime.title;
      saveArticleHistory(anime.title, articleContent, wpTitle, anime.link, "アニメ");
      const wpResult = postToWordPress(wpTitle, articleContent, "draft");
      if (wpResult) updateHistoryWithWpUrl(wpTitle, wpResult.link);
      Logger.log("投稿完了：" + wpTitle);
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
      if (isDuplicateArticle(manga.title)) {
        Logger.log("スキップ（重複）：" + manga.title);
        return;
      }
      Logger.log("漫画 " + (index + 1) + "件目：" + manga.title);
      const cleanSummary = manga.summary.replace(/<[^>]*>/g, "").trim();
      const articleContent = callClaudeManga(manga.title, cleanSummary);
      const wpTitle = extractArticleTitle(articleContent) || manga.title;
      saveArticleHistory(manga.title, articleContent, wpTitle, manga.link, "漫画");
      const wpResult = postToWordPress(wpTitle, articleContent, "draft");
      if (wpResult) updateHistoryWithWpUrl(wpTitle, wpResult.link);
      Logger.log("投稿完了：" + wpTitle);
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

// ============================================================
// ① WordPress REST API 自動投稿
// ============================================================
// ScriptProperties に以下を設定してください：
//   WP_URL       : https://your-blog.com  （末尾スラッシュなし）
//   WP_USERNAME  : WordPressのユーザー名
//   WP_APP_PASSWORD : 「アプリケーションパスワード」（設定→ユーザー→プロフィールで発行）
// postStatus: "draft"（下書き） または "publish"（即公開）
function postToWordPress(title, content, postStatus) {
  const props = PropertiesService.getScriptProperties();
  const wpUrl     = props.getProperty("WP_URL");
  const username  = props.getProperty("WP_USERNAME");
  const appPass   = props.getProperty("WP_APP_PASSWORD");

  if (!wpUrl || !username || !appPass) {
    Logger.log("WordPress設定未完了：WP_URL / WP_USERNAME / WP_APP_PASSWORD を ScriptProperties に設定してください");
    return null;
  }

  const credentials = Utilities.base64Encode(username + ":" + appPass);

  const payload = {
    title:   title,
    content: content,
    status:  postStatus || "draft"
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "Authorization": "Basic " + credentials
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(wpUrl + "/wp-json/wp/v2/posts", options);
    const statusCode = response.getResponseCode();

    if (statusCode === 201) {
      const result = JSON.parse(response.getContentText());
      Logger.log("WordPress投稿成功：ID=" + result.id + " URL=" + result.link);
      return result;
    } else {
      Logger.log("WordPress投稿失敗：HTTP " + statusCode + " → " + response.getContentText());
      return null;
    }
  } catch(e) {
    Logger.log("WordPress投稿エラー：" + e.message);
    return null;
  }
}

// ============================================================
// ② スプレッドシートへの記事履歴保存 ＋ 重複チェック
// ============================================================
// スプレッドシートID（getActiveGenres と同じシート）の「履歴」シートを使用
// シートがなければ自動作成します
const SS_ID = "141tleCwlMGBaEi6ST_ARzFiOqefPwZHvmHiZnJw09is";

function getHistorySheet() {
  const ss = SpreadsheetApp.openById(SS_ID);
  let sheet = ss.getSheetByName("履歴");
  if (!sheet) {
    sheet = ss.insertSheet("履歴");
    // ヘッダー行を設定
    sheet.appendRow(["生成日時", "RSSタイトル", "記事タイトル", "カテゴリ", "ソースURL", "WordPressURL", "本文（先頭300字）"]);
    sheet.setFrozenRows(1);
    Logger.log("「履歴」シートを新規作成しました");
  }
  return sheet;
}

function saveArticleHistory(rssTitle, articleContent, wpTitle, sourceLink, category) {
  const sheet = getHistorySheet();
  const now   = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  const excerpt = articleContent.replace(/<[^>]*>/g, "").substring(0, 300);

  sheet.appendRow([now, rssTitle, wpTitle, category, sourceLink || "", "", excerpt]);
  Logger.log("履歴保存：" + wpTitle);
}

// WordPress投稿後にURLを履歴に書き込む
function updateHistoryWithWpUrl(wpTitle, wpUrl) {
  const sheet = getHistorySheet();
  const data  = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][2] === wpTitle) {
      sheet.getRange(i + 1, 6).setValue(wpUrl);
      break;
    }
  }
}

// RSSタイトルが「履歴」シートに存在するか確認（重複防止）
function isDuplicateArticle(rssTitle) {
  const sheet = getHistorySheet();
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === rssTitle) {
      return true;
    }
  }
  return false;
}

// 生成記事の最初のh2/h3タグからタイトルを抽出するユーティリティ
function extractArticleTitle(articleContent) {
  const match = articleContent.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
  if (match) {
    return match[1].replace(/<[^>]*>/g, "").trim();
  }
  // h2/h3がなければ最初の行を使用
  const firstLine = articleContent.split("\n")[0].replace(/<[^>]*>/g, "").trim();
  return firstLine.length > 0 ? firstLine : null;
}

// ============================================================
// ③ GASトリガー設定（毎日自動実行）
// ============================================================
// GASエディタで手動実行してください（初回のみ）
// 毎日 AM 7:00 に generateAllArticles を自動実行します
function setupDailyTrigger() {
  // 既存の同名トリガーを削除してから再登録（重複防止）
  deleteDailyTrigger();

  ScriptApp.newTrigger("generateAllArticles")
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  Logger.log("毎日AM7:00に generateAllArticles を実行するトリガーを設定しました");
}

// generateAllArticles のトリガーをすべて削除する
function deleteDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "generateAllArticles") {
      ScriptApp.deleteTrigger(trigger);
      Logger.log("既存トリガー削除：" + trigger.getUniqueId());
    }
  });
}

// 現在設定されているトリガーを一覧表示する
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    Logger.log("トリガーは設定されていません");
    return;
  }
  triggers.forEach(function(trigger) {
    Logger.log(
      "関数：" + trigger.getHandlerFunction() +
      " ／ 種別：" + trigger.getEventType() +
      " ／ ID：" + trigger.getUniqueId()
    );
  });
}