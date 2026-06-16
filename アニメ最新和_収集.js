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

// タイトルの類似度チェック（文字バイグラム＋Jaccard係数、0.5以上で類似判定）
// 日本語はスペースで区切れないため、2文字単位のn-gramで比較する
function isSimilarTitle(titleA, titleB) {
  function getBigrams(str) {
    // ノイズ除去（アニメ/TV/記号/括弧など）
    const clean = str
      .replace(/TVアニメ|TV|アニメ|漫画|第\d+[話期巻章]/g, "")
      .replace(/【[^】]*】|「|」|『|』|（[^）]*）|\([^)]*\)/g, "")
      .replace(/[！？!?\s　]+/g, "");
    const bigrams = new Set();
    for (let i = 0; i < clean.length - 1; i++) {
      bigrams.add(clean.substring(i, i + 2));
    }
    return bigrams;
  }
  const setA = getBigrams(titleA);
  const setB = getBigrams(titleB);
  if (setA.size < 3 || setB.size < 3) return false; // 短すぎるタイトルは判定しない
  let intersection = 0;
  setA.forEach(function(bg) { if (setB.has(bg)) intersection++; });
  const union = setA.size + setB.size - intersection;
  return intersection / union >= 0.4;
}

// 類似タイトルを除去（順番が早いものを優先して残す）
function deduplicateBySimilarity(items) {
  const result = [];
  items.forEach(function(item) {
    const isDupe = result.some(function(existing) {
      return isSimilarTitle(existing.title, item.title);
    });
    if (!isDupe) result.push(item);
  });
  Logger.log("類似度除去前：" + items.length + "件 → 除去後：" + result.length + "件");
  return result;
}

// RSS/Atom/RDF(RSS1.0)全形式に対応したフィードパーサー
function parseFeed(xml) {
  const document = XmlService.parse(xml);
  const root = document.getRootElement();
  const rootName = root.getName();

  // Atom形式（<feed><entry>）
  if (rootName === "feed") {
    const ns = root.getNamespace();
    const entries = root.getChildren("entry", ns);
    return entries.map(function(entry) {
      const title = entry.getChildText("title", ns) || "";
      const summary = entry.getChildText("summary", ns) || entry.getChildText("content", ns) || "";
      const updated = entry.getChildText("updated", ns) || entry.getChildText("published", ns) || "";
      const linkEl = entry.getChild("link", ns);
      const link = linkEl ? (linkEl.getAttribute("href") ? linkEl.getAttribute("href").getValue() : linkEl.getText()) : "";
      return { title: title, summary: summary, pubDate: updated, link: link };
    });
  }

  // RDF形式 = RSS 1.0（<rdf:RDF><item>）
  if (rootName === "RDF") {
    const rss1Ns = XmlService.getNamespace("http://purl.org/rss/1.0/");
    const dcNs   = XmlService.getNamespace("http://purl.org/dc/elements/1.1/");
    const items  = root.getChildren("item", rss1Ns);
    return items.map(function(item) {
      return {
        title:   item.getChildText("title",       rss1Ns) || "",
        summary: item.getChildText("description", rss1Ns) || "",
        pubDate: item.getChildText("date",        dcNs)   || "",
        link:    item.getChildText("link",        rss1Ns) || ""
      };
    });
  }

  // RSS 2.0形式（<channel><item>）
  const channel = root.getChild("channel");
  if (!channel) {
    Logger.log("未対応フォーマット：ルートタグ=" + rootName + " xmlns=" + root.getNamespace().getURI());
    return [];
  }
  const items = channel.getChildren("item");
  return items.map(function(item) {
    return {
      title:   item.getChildText("title")       || "",
      summary: item.getChildText("description") || "",
      pubDate: item.getChildText("pubDate")     || "",
      link:    item.getChildText("link")        || ""
    };
  });
}

function fetchLatestAnime() {
  const RSS_URLS = [
    // donanetwork（RSS 2.0）
    "https://donanetwork.jp/category/tv-anime-broadcast-information/feed",
    "https://donanetwork.jp/category/infoanime/feed",
    "https://donanetwork.jp/category/anime-and-comic-information/feed",
    // アニメ！アニメ！（RSS 1.0 / RDF形式）
    "https://animeanime.jp/rss/index.rdf",
    // MANTANWEB まんたんウェブ（アニメ・漫画・映画）
    "https://mantan-web.jp/index.rss"
  ];

  const allItems = [];
  const seenTitles = new Set();

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
      if (!xml || xml.length === 0) {
        Logger.log("スキップ（空レスポンス）：" + RSS_URLS[i]);
        continue;
      }

      const parsed = parseFeed(xml);
      Logger.log("記事数：" + parsed.length + "件 (" + RSS_URLS[i] + ")");

      parsed.forEach(function(item) {
        if (!item.title || seenTitles.has(item.title)) return;
        seenTitles.add(item.title);
        allItems.push({
          title: item.title,
          summary: item.summary.replace(/<[^>]*>/g, "").substring(0, 200),
          pubDate: item.pubDate,
          link: item.link
        });
      });

    } catch(e) {
      Logger.log("エラー：" + RSS_URLS[i] + " → " + e.message);
    }
  }

  const deduplicated = deduplicateBySimilarity(allItems);
  Logger.log("合計取得件数：" + deduplicated.length + "件");
  return deduplicated;
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
  const animeCategoryId = getOrCreateCategory("アニメ考察");
  const animeList = fetchLatestAnimeWithRecovery();

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
      const rawArticle = callClaude(anime.title, "最新情報", cleanSummary);
      const wpTitle = extractArticleTitle(rawArticle) || anime.title;
      let articleContent = markdownToHtml(rawArticle);
      articleContent = insertAffiliateLinks(articleContent, anime.title, "アニメ");

      const thumbUrl = generateThumbnail(anime.title);
      const mediaId  = thumbUrl ? uploadMediaToWordPress(thumbUrl, "thumb_anime_" + Date.now()) : null;

      const wpResult = postToWordPress(wpTitle, articleContent, "draft", mediaId, animeCategoryId);
      if (wpResult) {
        // 投稿に成功したときだけ履歴へ保存（失敗時は次回リトライ）
        saveArticleHistory(anime.title, articleContent, wpTitle, anime.link, "アニメ");
        updateHistoryWithWpUrl(wpTitle, wpResult.link);
        postToX(buildXPostText(wpTitle, wpResult.link, "アニメ"));
        Logger.log("投稿完了：" + wpTitle);
      } else {
        Logger.log("投稿失敗のため履歴に保存しません（次回リトライ）：" + wpTitle);
      }
      Utilities.sleep(3000);
    });
  }

  Logger.log("=== 漫画記事生成開始 ===");
  const mangaCategoryId = getOrCreateCategory("漫画考察");
  const mangaList = fetchLatestManga();

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
      const rawArticle = callClaudeManga(manga.title, cleanSummary);
      const wpTitle = extractArticleTitle(rawArticle) || manga.title;
      let articleContent = markdownToHtml(rawArticle);
      articleContent = insertAffiliateLinks(articleContent, manga.title, "漫画");

      const thumbUrl = generateThumbnail(manga.title);
      const mediaId  = thumbUrl ? uploadMediaToWordPress(thumbUrl, "thumb_manga_" + Date.now()) : null;

      const wpResult = postToWordPress(wpTitle, articleContent, "draft", mediaId, mangaCategoryId);
      if (wpResult) {
        // 投稿に成功したときだけ履歴へ保存（失敗時は次回リトライ）
        saveArticleHistory(manga.title, articleContent, wpTitle, manga.link, "漫画");
        updateHistoryWithWpUrl(wpTitle, wpResult.link);
        postToX(buildXPostText(wpTitle, wpResult.link, "漫画"));
        Logger.log("投稿完了：" + wpTitle);
      } else {
        Logger.log("投稿失敗のため履歴に保存しません（次回リトライ）：" + wpTitle);
      }
      Utilities.sleep(3000);
    });
  }

  Logger.log("=== 全記事生成完了！ ===");
}

// ⑪ 漫画専用RSS取得関数（アニメと重複しないソースのみ使用）
function fetchLatestManga() {
  const RSS_URLS = [
    // donanetwork 漫画カテゴリ（アニメリストと被るが完全一致除去で対応）
    "https://donanetwork.jp/category/anime-and-comic-information/feed",
    // MANTANWEB（漫画・アニメ情報）
    "https://mantan-web.jp/index.rss",
    // マンバ通信（漫画専門メディア）
    "https://manba.co.jp/manba_magazines/feed"
  ];

  const allItems = [];
  const seenTitles = new Set();

  for (let i = 0; i < RSS_URLS.length; i++) {
    try {
      const response = UrlFetchApp.fetch(RSS_URLS[i], {
        muteHttpExceptions: true
      });
      if (response.getResponseCode() !== 200) continue;

      const xml = response.getContentText();
      if (!xml || xml.length === 0) continue;

      const parsed = parseFeed(xml);
      Logger.log("漫画RSS成功：" + parsed.length + "件 (" + RSS_URLS[i] + ")");

      parsed.forEach(function(item) {
        if (!item.title || seenTitles.has(item.title)) return;
        seenTitles.add(item.title);
        allItems.push({
          title: item.title,
          summary: item.summary.replace(/<[^>]*>/g, "").substring(0, 200),
          pubDate: item.pubDate,
          link: item.link
        });
      });

    } catch(e) {
      Logger.log("漫画RSSエラー：" + e.message);
    }
  }

  const deduplicated = deduplicateBySimilarity(allItems);
  Logger.log("漫画合計取得件数：" + deduplicated.length + "件");
  return deduplicated;
}

// スプレッドシートからONのジャンル・キーワードを取得
function getActiveGenres() {
  try {
    const spreadsheetId = getOrCreateSpreadsheetId();
    const sheet = SpreadsheetApp
                    .openById(spreadsheetId)
                    .getSheetByName("設定");
    const rows = sheet.getDataRange().getValues();

    const activeKeywords = [];

    // 1行目はヘッダーなのでスキップ（i=1から開始）
    for (let i = 1; i < rows.length; i++) {
      const genreName = rows[i][0];  // A列：ジャンル名
      const isActive  = rows[i][1];  // B列：チェックボックス
      const keywords  = rows[i][2];  // C列：キーワード

      if (isActive && genreName) {
        const kwList = keywords.split("、").map(function(k) { return k.trim(); });
        activeKeywords.push.apply(activeKeywords, kwList);
      }
    }

    Logger.log("有効なキーワード：" + activeKeywords.join(", "));
    return activeKeywords;

  } catch(e) {
    // スプレッドシートにアクセスできない場合は全件処理を続行
    Logger.log("ジャンル設定読み込み失敗（全件処理します）：" + e.message);
    return [];
  }
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
// カテゴリ自動取得・作成ヘルパー
// ============================================================
// 指定した名前のカテゴリIDを返す。なければ自動作成する。
function getOrCreateCategory(categoryName) {
  const props = PropertiesService.getScriptProperties();
  const wpUrl    = props.getProperty("WP_URL");
  const username = props.getProperty("WP_USERNAME");
  const appPass  = props.getProperty("WP_APP_PASSWORD");
  const credentials = Utilities.base64Encode(username + ":" + appPass);
  const headers = { "Authorization": "Basic " + credentials };

  // まず既存カテゴリを検索
  const searchRes = UrlFetchApp.fetch(
    wpUrl + "/wp-json/wp/v2/categories?search=" + encodeURIComponent(categoryName) + "&per_page=10",
    { headers: headers, muteHttpExceptions: true }
  );
  if (searchRes.getResponseCode() === 200) {
    const cats = JSON.parse(searchRes.getContentText());
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].name === categoryName) {
        Logger.log("カテゴリ取得：" + categoryName + " (ID=" + cats[i].id + ")");
        return cats[i].id;
      }
    }
  }

  // なければ新規作成
  const createRes = UrlFetchApp.fetch(
    wpUrl + "/wp-json/wp/v2/categories",
    {
      method: "post",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify({ name: categoryName }),
      muteHttpExceptions: true
    }
  );
  if (createRes.getResponseCode() === 201) {
    const newCat = JSON.parse(createRes.getContentText());
    Logger.log("カテゴリ作成：" + categoryName + " (ID=" + newCat.id + ")");
    return newCat.id;
  }

  Logger.log("カテゴリ取得・作成失敗：" + categoryName);
  return null;
}

// ============================================================
// ① WordPress REST API 自動投稿
// ============================================================
// ScriptProperties に以下を設定してください：
//   WP_URL       : https://your-blog.com  （末尾スラッシュなし）
//   WP_USERNAME  : WordPressのユーザー名
//   WP_APP_PASSWORD : 「アプリケーションパスワード」（設定→ユーザー→プロフィールで発行）
// postStatus: "draft"（下書き） または "publish"（即公開）
// categoryId: WordPressのカテゴリID（省略可）
function postToWordPress(title, content, postStatus, featuredMediaId, categoryId) {
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
  if (featuredMediaId) payload.featured_media = featuredMediaId;
  if (categoryId)      payload.categories = [categoryId];

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
// GAS実行アカウントがアクセスできるスプレッドシートIDを返す
// 既存IDにアクセスできない場合は新規作成してScriptPropertiesに保存する
function getOrCreateSpreadsheetId() {
  const props = PropertiesService.getScriptProperties();
  const candidates = [
    props.getProperty("SS_ID"),
    "141tleCwlMGBaEi6ST_ARzFiOqefPwZHvmHiZnJw09is"
  ];

  // アクセスできるIDがあればそれを使う
  for (let i = 0; i < candidates.length; i++) {
    const id = candidates[i];
    if (!id) continue;
    try {
      SpreadsheetApp.openById(id);
      return id;
    } catch(e) {
      // アクセス不可 → 次の候補へ
    }
  }

  // どれもアクセスできない → 新規作成
  const ss = SpreadsheetApp.create("アニメ収益化_データ");
  const newId = ss.getId();

  // 「設定」シートを作成（ジャンルフィルタ用）
  const settingSheet = ss.getActiveSheet().setName("設定");
  settingSheet.appendRow(["ジャンル名", "有効／無効", "キーワード"]);
  settingSheet.appendRow(["アニメ全般", true, "アニメ、最新話、考察"]);
  settingSheet.appendRow(["異世界転生", true, "異世界、転生、isekai"]);
  settingSheet.setFrozenRows(1);

  props.setProperty("SS_ID", newId);
  Logger.log("新しいスプレッドシートを作成しました：" + ss.getUrl());
  return newId;
}

function getHistorySheet() {
  const spreadsheetId = getOrCreateSpreadsheetId();
  const ss = SpreadsheetApp.openById(spreadsheetId);
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

// 記事タイトルを抽出（マークダウン見出し・HTML見出し両対応・記号を除去）
function extractArticleTitle(articleContent) {
  const lines = articleContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // 先頭の # や ** などの記号を除去して最初の意味ある行をタイトルに
    const cleaned = line
      .replace(/<[^>]*>/g, "")        // HTMLタグ除去
      .replace(/^#{1,6}\s*/, "")      // 見出し記号 # を除去
      .replace(/\*\*/g, "")           // 太字記号を除去
      .replace(/^[-*]\s*/, "")        // 箇条書き記号を除去
      .trim();
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}

// マークダウンをWordPress用のHTMLに変換する
function markdownToHtml(md) {
  // 1行目が見出し（タイトル）の場合は本文から除去（WP側でタイトル表示するため）
  const lines = md.split("\n");
  if (lines.length > 0 && /^#{1,3}\s/.test(lines[0].trim())) {
    lines.shift();
  }
  md = lines.join("\n");

  const blocks = md.split(/\n{2,}/); // 空行でブロック分割
  const htmlParts = [];

  blocks.forEach(function(block) {
    block = block.trim();
    if (!block) return;

    // 水平線
    if (/^-{3,}$/.test(block)) {
      return; // 区切り線は出力しない（見た目すっきり）
    }

    // 見出し
    let m;
    if ((m = block.match(/^###\s+(.*)$/))) {
      htmlParts.push("<h3>" + inlineMd(m[1]) + "</h3>");
      return;
    }
    if ((m = block.match(/^##\s+(.*)$/))) {
      htmlParts.push("<h2>" + inlineMd(m[1]) + "</h2>");
      return;
    }
    if ((m = block.match(/^#\s+(.*)$/))) {
      htmlParts.push("<h2>" + inlineMd(m[1]) + "</h2>");
      return;
    }

    // 箇条書きリスト（行頭が - か * の連続）
    const blockLines = block.split("\n");
    const isList = blockLines.every(function(l) { return /^\s*[-*]\s+/.test(l); });
    if (isList) {
      const items = blockLines.map(function(l) {
        return "<li>" + inlineMd(l.replace(/^\s*[-*]\s+/, "")) + "</li>";
      });
      htmlParts.push("<ul>" + items.join("") + "</ul>");
      return;
    }

    // 通常段落（ブロック内の改行は<br>に）
    htmlParts.push("<p>" + inlineMd(block).replace(/\n/g, "<br>") + "</p>");
  });

  return htmlParts.join("\n");
}

// インライン記法（太字・リンク）を変換
function inlineMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")   // **太字**
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>'); // [text](url)
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

// ============================================================
// ④ DALL-E 3 サムネイル自動生成 + WordPress メディアアップロード
// ============================================================
// ScriptProperties に追加：
//   OPENAI_API_KEY : OpenAI APIキー（platform.openai.com で発行）

function generateThumbnail(animeTitle) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY");
  if (!apiKey) {
    Logger.log("OPENAI_API_KEY が未設定のためサムネイル生成をスキップします");
    return null;
  }

  const prompt =
    "アニメ・漫画「" + animeTitle + "」の考察ブログ用サムネイル画像。" +
    "ポップなイラスト風、鮮やかな色彩、日本のアニメらしいデザイン。" +
    "テキストなし、特定キャラクターなし（著作権回避）。";

  const payload = {
    model: "dall-e-3",
    prompt: prompt,
    n: 1,
    size: "1024x1024"
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch("https://api.openai.com/v1/images/generations", options);
    if (response.getResponseCode() !== 200) {
      Logger.log("DALL-E 3 エラー：HTTP " + response.getResponseCode() + " " + response.getContentText());
      return null;
    }
    const result = JSON.parse(response.getContentText());
    Logger.log("サムネイル生成成功：" + animeTitle);
    return result.data[0].url;
  } catch(e) {
    Logger.log("DALL-E 3 例外：" + e.message);
    return null;
  }
}

// DALL-E 3 が返した画像URLをWordPressメディアライブラリへアップロード
// 成功時はメディアIDを返す（WordPress投稿のアイキャッチに設定するため）
function uploadMediaToWordPress(imageUrl, filename) {
  const props    = PropertiesService.getScriptProperties();
  const wpUrl    = props.getProperty("WP_URL");
  const username = props.getProperty("WP_USERNAME");
  const appPass  = props.getProperty("WP_APP_PASSWORD");

  if (!wpUrl || !username || !appPass) return null;

  try {
    const imgBlob = UrlFetchApp.fetch(imageUrl).getBlob().setName(filename + ".png");
    const credentials = Utilities.base64Encode(username + ":" + appPass);

    const options = {
      method: "post",
      headers: {
        "Authorization": "Basic " + credentials,
        "Content-Disposition": 'attachment; filename="' + filename + '.png"'
      },
      contentType: "image/png",
      payload: imgBlob.getBytes(),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(wpUrl + "/wp-json/wp/v2/media", options);
    if (response.getResponseCode() === 201) {
      const result = JSON.parse(response.getContentText());
      Logger.log("WPメディアアップロード成功：ID=" + result.id);
      return result.id;
    } else {
      Logger.log("WPメディアアップロード失敗：HTTP " + response.getResponseCode());
      return null;
    }
  } catch(e) {
    Logger.log("WPメディアアップロード例外：" + e.message);
    return null;
  }
}

// ============================================================
// ⑤ アフィリエイトリンク自動挿入（Amazon アソシエイト）
// ============================================================
// ScriptProperties に追加：
//   AMAZON_ASSOCIATE_ID : Amazonアソシエイトのトラッキングタグ（例：yourtag-22）

function insertAffiliateLinks(articleContent, title, category) {
  const associateId = PropertiesService.getScriptProperties().getProperty("AMAZON_ASSOCIATE_ID");
  if (!associateId) return articleContent;

  const encodedTitle = encodeURIComponent(title);
  const amazonUrl = "https://www.amazon.co.jp/s?k=" + encodedTitle + "&tag=" + associateId;

  const affiliateBlock =
    '\n<div class="affiliate-box" style="background:#fff8e1;border:2px solid #ff9800;' +
    'padding:16px;margin:24px 0;border-radius:8px;">' +
    '<p style="margin:0 0 8px;font-weight:bold;">関連グッズ・コミックをAmazonでチェック</p>' +
    '<a href="' + amazonUrl + '" target="_blank" rel="nofollow noopener" ' +
    'style="color:#e65100;font-weight:bold;">▶ Amazon で「' + title + '」を探す</a>' +
    '</div>\n';

  // まとめ見出し（最後の </h2> か </h3>）の直後に挿入
  const lastH2 = articleContent.lastIndexOf("</h2>");
  const lastH3 = articleContent.lastIndexOf("</h3>");
  const insertPos = Math.max(lastH2, lastH3);

  if (insertPos !== -1) {
    const endTag = insertPos === lastH2 ? "</h2>" : "</h3>";
    const splitAt = insertPos + endTag.length;
    return articleContent.substring(0, splitAt) + affiliateBlock + articleContent.substring(splitAt);
  }
  return articleContent + affiliateBlock;
}

// ============================================================
// ⑥ X (Twitter) 自動投稿（OAuth 1.0a）
// ============================================================
// ScriptProperties に追加：
//   X_API_KEY        : Consumer Key
//   X_API_SECRET     : Consumer Secret
//   X_ACCESS_TOKEN   : Access Token
//   X_ACCESS_SECRET  : Access Token Secret
// ※ Twitter Developer Portal で「Read and Write」権限のAppが必要

function postToX(text) {
  const props       = PropertiesService.getScriptProperties();
  const apiKey      = props.getProperty("X_API_KEY");
  const apiSecret   = props.getProperty("X_API_SECRET");
  const accToken    = props.getProperty("X_ACCESS_TOKEN");
  const accSecret   = props.getProperty("X_ACCESS_SECRET");

  if (!apiKey || !apiSecret || !accToken || !accSecret) {
    Logger.log("X API設定未完了：X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET を設定してください");
    return null;
  }

  const url = "https://api.twitter.com/2/tweets";

  const oauthParams = {
    oauth_consumer_key:     apiKey,
    oauth_nonce:            Utilities.base64Encode(
                              Utilities.newBlob(Math.random().toString()).getBytes()
                            ).replace(/[^a-zA-Z0-9]/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
    oauth_token:            accToken,
    oauth_version:          "1.0"
  };

  // OAuth 1.0a 署名
  const paramString = Object.keys(oauthParams).sort()
    .map(function(k) { return encodeURIComponent(k) + "=" + encodeURIComponent(oauthParams[k]); })
    .join("&");
  const signatureBase = "POST&" + encodeURIComponent(url) + "&" + encodeURIComponent(paramString);
  const signingKey    = encodeURIComponent(apiSecret) + "&" + encodeURIComponent(accSecret);
  const signature     = Utilities.base64Encode(
    Utilities.computeHmacSha1Signature(signatureBase, signingKey)
  );
  oauthParams.oauth_signature = signature;

  const authHeader = "OAuth " + Object.keys(oauthParams).sort()
    .map(function(k) {
      return encodeURIComponent(k) + '="' + encodeURIComponent(oauthParams[k]) + '"';
    }).join(", ");

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": authHeader },
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 201) {
      const result = JSON.parse(response.getContentText());
      Logger.log("X投稿成功：" + result.data.id);
      return result;
    } else {
      Logger.log("X投稿失敗：HTTP " + response.getResponseCode() + " → " + response.getContentText());
      return null;
    }
  } catch(e) {
    Logger.log("X投稿例外：" + e.message);
    return null;
  }
}

// X投稿テキストを組み立てる（280文字以内）
function buildXPostText(wpTitle, wpUrl, category) {
  const tag = category === "漫画"
    ? "#漫画 #漫画考察 #マンガ"
    : "#アニメ #アニメ考察 #anime";
  const text = "【新着考察】" + wpTitle + "\n\n" + tag + "\n\n" + wpUrl;
  return text.length <= 280 ? text : text.substring(0, 277) + "...";
}

// ============================================================
// ⑦ 週3回トリガー設定（月・水・金 AM6:00）
// ============================================================
// setupWeeklyTriggers() を手動で1回実行するだけでOKです
// ※ setupDailyTrigger は週3回版に置き換えられました

function setupWeeklyTriggers() {
  deleteDailyTrigger(); // 既存の日次トリガーをすべて削除

  const days = [
    ScriptApp.WeekDay.MONDAY,
    ScriptApp.WeekDay.WEDNESDAY,
    ScriptApp.WeekDay.FRIDAY
  ];

  days.forEach(function(day) {
    ScriptApp.newTrigger("generateAllArticles")
      .timeBased()
      .onWeekDay(day)
      .atHour(6)
      .create();
  });

  Logger.log("週3回（月・水・金 AM6:00）トリガーを設定しました");
  listTriggers();
}

// ============================================================
// 手動記事選択機能
// ============================================================

// RSSから最新記事一覧をスプレッドシートに書き出す
// GASエディタから「listArticlesToSheet」を実行するだけでOK
function listArticlesToSheet() {
  const spreadsheetId = getOrCreateSpreadsheetId();
  const ss = SpreadsheetApp.openById(spreadsheetId);

  // シートがなければ作成
  let sheet = ss.getSheetByName("手動投稿リスト");
  if (!sheet) {
    sheet = ss.insertSheet("手動投稿リスト");
  }

  // 既存データをクリア
  sheet.clearContents();
  sheet.clearFormats();

  // ヘッダー
  const headers = ["選択", "ジャンル", "タイトル", "日付", "概要（先頭100字）", "元URL"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#4a86e8")
    .setFontColor("#ffffff")
    .setFontWeight("bold");

  // アニメ記事取得
  const animeList = fetchLatestAnimeWithRecovery().map(function(item) {
    return {
      genre: "アニメ",
      title: item.title,
      pubDate: item.pubDate || "",
      summary: (item.summary || "").replace(/<[^>]*>/g, "").substring(0, 100),
      link: item.link || ""
    };
  });

  // 漫画記事取得
  const mangaList = fetchLatestManga().map(function(item) {
    return {
      genre: "漫画",
      title: item.title,
      pubDate: item.pubDate || "",
      summary: (item.summary || "").replace(/<[^>]*>/g, "").substring(0, 100),
      link: item.link || ""
    };
  });

  // アニメ・漫画を合算（クロスリストは完全一致のみ除去。類似度チェックは各リスト内で実施済み）
  const animeTitles = new Set(animeList.map(function(i) { return i.title; }));
  const mangaOnly = mangaList.filter(function(i) { return !animeTitles.has(i.title); });
  const allItems = animeList.concat(mangaOnly);

  Logger.log("アニメ：" + animeList.length + "件、漫画（重複除去後）：" + mangaOnly.length + "件 → 合計：" + allItems.length + "件");

  if (allItems.length === 0) {
    Logger.log("記事が取得できませんでした");
    return;
  }

  // データ書き込み（2行目から）
  const dataRows = allItems.map(function(item) {
    return [false, item.genre, item.title, item.pubDate, item.summary, item.link];
  });
  sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);

  // A列をチェックボックスに設定
  sheet.getRange(2, 1, dataRows.length, 1).insertCheckboxes();

  // 列幅を見やすく調整
  sheet.setColumnWidth(1, 50);   // 選択
  sheet.setColumnWidth(2, 80);   // ジャンル
  sheet.setColumnWidth(3, 350);  // タイトル
  sheet.setColumnWidth(4, 150);  // 日付
  sheet.setColumnWidth(5, 300);  // 概要
  sheet.setColumnWidth(6, 200);  // URL

  Logger.log("スプレッドシートに " + allItems.length + " 件を書き出しました");
  Logger.log("「手動投稿リスト」シートを開いて、投稿したい記事の「選択」列にチェックを入れてください");
  Logger.log("その後 generateFromManualList() を実行してください");
}

// 「手動投稿リスト」シートでチェックした記事だけ記事生成・WP投稿する
function generateFromManualList() {
  const spreadsheetId = getOrCreateSpreadsheetId();
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName("手動投稿リスト");

  if (!sheet) {
    Logger.log("「手動投稿リスト」シートが見つかりません。先に listArticlesToSheet() を実行してください");
    return;
  }

  const data = sheet.getDataRange().getValues();
  // 1行目はヘッダー、2行目以降がデータ
  const selected = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === true) {
      selected.push({
        genre:   data[i][1],
        title:   data[i][2],
        pubDate: data[i][3],
        summary: data[i][4],
        link:    data[i][5]
      });
    }
  }

  if (selected.length === 0) {
    Logger.log("チェックされた記事がありません。スプレッドシートの「選択」列にチェックを入れてください");
    return;
  }

  Logger.log("手動選択記事 " + selected.length + " 件を処理します");

  const animeCategoryId = getOrCreateCategory("アニメ考察");
  const mangaCategoryId = getOrCreateCategory("漫画考察");

  selected.forEach(function(item, index) {
    Logger.log("=== " + (index + 1) + "/" + selected.length + " ：" + item.title + " ===");

    if (isDuplicateArticle(item.title)) {
      Logger.log("スキップ（重複）：" + item.title);
      return;
    }

    const categoryId = item.genre === "漫画" ? mangaCategoryId : animeCategoryId;
    const cleanSummary = (item.summary || "").replace(/<[^>]*>/g, "").trim();

    const rawArticle = item.genre === "漫画"
      ? callClaudeManga(item.title, cleanSummary)
      : callClaude(item.title, "最新情報", cleanSummary);

    const wpTitle = extractArticleTitle(rawArticle) || item.title;
    let articleContent = markdownToHtml(rawArticle);
    articleContent = insertAffiliateLinks(articleContent, item.title, item.genre);

    const thumbUrl = generateThumbnail(item.title);
    const mediaId  = thumbUrl ? uploadMediaToWordPress(thumbUrl, "thumb_manual_" + Date.now()) : null;

    const wpResult = postToWordPress(wpTitle, articleContent, "draft", mediaId, categoryId);
    if (wpResult) {
      saveArticleHistory(item.title, articleContent, wpTitle, item.link, item.genre);
      updateHistoryWithWpUrl(wpTitle, wpResult.link);
      postToX(buildXPostText(wpTitle, wpResult.link, item.genre));
      Logger.log("投稿完了：" + wpTitle + " → " + wpResult.link);
    } else {
      Logger.log("投稿失敗（履歴未保存）：" + wpTitle);
    }

    Utilities.sleep(3000);
  });

  Logger.log("=== 手動投稿処理完了 ===");
}