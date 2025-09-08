// Geoshape CSVからディレクトリ一覧を取得し表示する

const CSV_URL = 'https://geoshape.ex.nii.ac.jp/city/dataset/json-list.csv';

/**
 * ページ読み込み時に実行
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('Geoshape tools loaded');
});

/**
 * CSVデータを取得してディレクトリ一覧を表示
 */
async function loadDirectoryList() {
    const statusElement = document.getElementById('status');
    const treeContainer = document.getElementById('treeContainer');
    
    try {
        statusElement.textContent = 'データを取得中...';
        statusElement.className = 'loading';
        treeContainer.innerHTML = '';
        
        // CSVデータを取得
        const response = await fetch(CSV_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        console.log('CSV data received:', csvText.substring(0, 200) + '...');
        
        // CSVをパース
        const hierarchicalData = parseCSVAndExtractDirectories(csvText);
        
        // 階層リストを作成して表示
        displayDirectoryTree(hierarchicalData);
        
        statusElement.textContent = `階層構造が表示されました`;
        statusElement.className = '';
        
    } catch (error) {
        console.error('Error loading data:', error);
        statusElement.textContent = `エラー: ${error.message}`;
        statusElement.className = 'error';
    }
}

/**
 * CSVテキストをパースしてディレクトリ一覧を抽出
 * @param {string} csvText - CSVテキストデータ
 * @returns {Array} 階層構造化されたディレクトリの配列
 */
function parseCSVAndExtractDirectories(csvText) {
    const lines = csvText.trim().split('\n');
    const directories = new Set(); // 重複を排除するためにSetを使用
    
    // ヘッダー行をスキップして処理
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // CSVの最初の列（URL）を取得
        const columns = line.split('\t'); // タブ区切りの場合
        if (columns.length < 3) {
            // カンマ区切りの場合も試す
            const csvColumns = line.split(',');
            if (csvColumns.length >= 3) {
                columns.splice(0, columns.length, ...csvColumns);
            }
        }
        
        const url = columns[0];
        if (url && url.startsWith('https://')) {
            const directory = extractDirectoryFromURL(url);
            if (directory) {
                directories.add(directory);
            }
        }
    }
    
    // 階層構造を分析
    return buildHierarchicalStructure(Array.from(directories));
}

/**
 * URLからディレクトリパスを抽出（/city/geojson/以下の部分のみ）
 * @param {string} url - GeoJSONファイルのURL
 * @returns {string|null} 相対ディレクトリパス
 */
function extractDirectoryFromURL(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        
        // /city/geojson/以下の部分を抽出
        const basePattern = '/city/geojson/';
        const baseIndex = pathname.indexOf(basePattern);
        
        if (baseIndex === -1) {
            return null;
        }
        
        // ファイル名を除いたディレクトリパスを取得
        const lastSlashIndex = pathname.lastIndexOf('/');
        if (lastSlashIndex > baseIndex + basePattern.length - 1) {
            const relativePath = pathname.substring(baseIndex + basePattern.length, lastSlashIndex);
            return relativePath;
        }
        
        return null;
    } catch (error) {
        console.error('Invalid URL:', url, error);
        return null;
    }
}

/**
 * ディレクトリパスのリストから階層構造を構築
 * @param {Array} directories - ディレクトリパスの配列
 * @returns {Object} 階層構造のツリーデータ
 */
function buildHierarchicalStructure(directories) {
    // パスを階層ごとに分割
    const pathStructure = {};
    
    directories.forEach(dir => {
        const parts = dir.split('/').filter(part => part.length > 0);
        let current = pathStructure;
        
        parts.forEach((part, index) => {
            if (!current[part]) {
                current[part] = {
                    name: part,
                    fullPath: parts.slice(0, index + 1).join('/'),
                    children: {},
                    level: index
                };
            }
            current = current[part].children;
        });
    });
    
    return pathStructure;
}

/**
 * ディレクトリ一覧を階層構造のリストとして表示
 * @param {Object} hierarchicalData - 階層構造のツリーデータ
 */
function displayDirectoryTree(hierarchicalData) {
    const treeContainer = document.getElementById('treeContainer');
    
    if (Object.keys(hierarchicalData).length === 0) {
        treeContainer.innerHTML = '<p>ディレクトリが見つかりませんでした。</p>';
        return;
    }
    
    // ルートのul要素を作成
    const rootUl = document.createElement('ul');
    
    // 階層構造を再帰的にDOM要素に変換
    buildTreeElements(hierarchicalData, rootUl);
    
    treeContainer.appendChild(rootUl);
}

/**
 * 階層構造を再帰的にDOM要素に変換
 * @param {Object} structure - 階層構造データ
 * @param {HTMLElement} parentUl - 親のul要素
 */
function buildTreeElements(structure, parentUl) {
    // 同じレベルのキーでソート
    const sortedKeys = Object.keys(structure).sort();
    
    sortedKeys.forEach(key => {
        const node = structure[key];
        const li = document.createElement('li');
        
        // ノードの情報を表示するdiv要素を作成
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'directory-node';
        
        // アイコンを追加
        const icon = document.createElement('span');
        const hasChildren = Object.keys(node.children).length > 0;
        icon.className = hasChildren ? 'folder-icon' : 'folder-icon'; // 全てフォルダアイコンに統一
        icon.textContent = hasChildren ? '📁' : '�'; // 子がある場合もない場合もフォルダアイコン
        nodeDiv.appendChild(icon);
        
        // ディレクトリ名を追加
        const nameSpan = document.createElement('span');
        nameSpan.className = 'directory-name';
        nameSpan.textContent = node.name;
        nodeDiv.appendChild(nameSpan);
        
        // 完全パスを追加
        const pathSpan = document.createElement('span');
        pathSpan.className = 'directory-path';
        pathSpan.textContent = node.fullPath;
        nodeDiv.appendChild(pathSpan);
        
        // URLリンクを追加
        const urlSpan = document.createElement('span');
        urlSpan.className = 'directory-url';
        const fullUrl = `https://geoshape.ex.nii.ac.jp/city/geojson/${node.fullPath}`;
        const link = document.createElement('a');
        link.href = fullUrl;
        link.textContent = 'Browse';
        link.target = '_blank';
        urlSpan.appendChild(link);
        nodeDiv.appendChild(urlSpan);
        
        // ダウンロードボタンを追加
        const downloadSpan = document.createElement('span');
        downloadSpan.className = 'download-button';
        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = 'GeoJSON結合DL';
        downloadBtn.onclick = () => downloadCombinedGeoJSON(node.fullPath);
        downloadSpan.appendChild(downloadBtn);
        nodeDiv.appendChild(downloadSpan);
        
        // レベル1ディレクトリの場合、分割ダウンロードボタンも追加
        if (node.level === 0 && hasChildren) {
            const splitDownloadSpan = document.createElement('span');
            splitDownloadSpan.className = 'download-button';
            const splitDownloadBtn = document.createElement('button');
            splitDownloadBtn.textContent = 'レベル2別DL';
            splitDownloadBtn.style.backgroundColor = '#007bff';
            splitDownloadBtn.onclick = () => downloadByLevel2(node.fullPath, node.children);
            splitDownloadSpan.appendChild(splitDownloadBtn);
            nodeDiv.appendChild(splitDownloadSpan);
        }
        
        li.appendChild(nodeDiv);
        
        // 子ノードがある場合は再帰的に処理
        if (hasChildren) {
            const childUl = document.createElement('ul');
            buildTreeElements(node.children, childUl);
            li.appendChild(childUl);
        }
        
        parentUl.appendChild(li);
    });
}

/**
 * 指定されたディレクトリ配下の全てのGeoJSONを結合してダウンロード
 * @param {string} directoryPath - ディレクトリパス
 */
async function downloadCombinedGeoJSON(directoryPath) {
    try {
        // ステータス表示
        const statusElement = document.getElementById('status');
        statusElement.textContent = `${directoryPath} 配下のGeoJSONを取得中...`;
        statusElement.className = 'loading';
        
        // CSVから該当ディレクトリ配下のGeoJSONファイルを取得
        const response = await fetch(CSV_URL);
        const csvText = await response.text();
        
        // 該当するGeoJSONファイルのURLを抽出
        const geojsonUrls = extractGeoJSONUrls(csvText, directoryPath);
        
        if (geojsonUrls.length === 0) {
            alert(`${directoryPath} 配下にGeoJSONファイルが見つかりませんでした。`);
            statusElement.textContent = '';
            return;
        }
        
        statusElement.textContent = `${geojsonUrls.length}個のGeoJSONファイルを結合中...`;
        
        // 各GeoJSONファイルを取得して結合
        const combinedFeatures = [];
        
        for (let i = 0; i < geojsonUrls.length; i++) {
            const url = geojsonUrls[i];
            statusElement.textContent = `GeoJSONを取得中... (${i + 1}/${geojsonUrls.length})`;
            
            try {
                const geoResponse = await fetch(url);
                if (geoResponse.ok) {
                    const geojson = await geoResponse.json();
                    if (geojson.features && Array.isArray(geojson.features)) {
                        combinedFeatures.push(...geojson.features);
                    }
                }
            } catch (error) {
                console.warn(`Failed to fetch ${url}:`, error);
            }
        }
        
        // 結合されたGeoJSONを作成
        const combinedGeoJSON = {
            type: "FeatureCollection",
            features: combinedFeatures
        };
        
        // ダウンロード
        const blob = new Blob([JSON.stringify(combinedGeoJSON, null, 2)], {
            type: 'application/json'
        });
        
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `combined_${directoryPath.replace(/\//g, '_')}.geojson`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        
        statusElement.textContent = `結合完了: ${combinedFeatures.length}個のフィーチャを含むGeoJSONをダウンロードしました`;
        statusElement.className = '';
        
    } catch (error) {
        console.error('Download error:', error);
        const statusElement = document.getElementById('status');
        statusElement.textContent = `エラー: ${error.message}`;
        statusElement.className = 'error';
    }
}

/**
 * CSVから指定ディレクトリ配下のGeoJSONファイルURLを抽出
 * @param {string} csvText - CSVテキスト
 * @param {string} targetPath - 対象ディレクトリパス
 * @returns {Array} GeoJSONファイルURLの配列
 */
function extractGeoJSONUrls(csvText, targetPath) {
    const lines = csvText.trim().split('\n');
    const urls = [];
    
    // ヘッダー行をスキップして処理
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // CSVの最初の列（URL）を取得
        const columns = line.split('\t');
        if (columns.length < 3) {
            const csvColumns = line.split(',');
            if (csvColumns.length >= 3) {
                columns.splice(0, columns.length, ...csvColumns);
            }
        }
        
        const url = columns[0];
        if (url && url.startsWith('https://') && url.includes('.geojson')) {
            // URLが対象ディレクトリ配下かチェック
            const urlPath = extractDirectoryFromURL(url + '/dummy'); // ダミーファイル名を追加してディレクトリ抽出
            if (urlPath && urlPath.startsWith(targetPath)) {
                urls.push(url);
            }
        }
    }
    
    return urls;
}

/**
 * レベル2ディレクトリごとに分けてGeoJSONをダウンロード
 * @param {string} level1Path - レベル1ディレクトリパス
 * @param {Object} level2Children - レベル2ディレクトリの子オブジェクト
 */
async function downloadByLevel2(level1Path, level2Children) {
    try {
        const statusElement = document.getElementById('status');
        statusElement.textContent = `${level1Path} をレベル2ディレクトリごとに分割ダウンロード中...`;
        statusElement.className = 'loading';
        
        // CSVデータを取得
        const response = await fetch(CSV_URL);
        const csvText = await response.text();
        
        const level2Keys = Object.keys(level2Children).sort();
        let completedCount = 0;
        
        // 各レベル2ディレクトリごとに処理
        for (const level2Key of level2Keys) {
            const level2Node = level2Children[level2Key];
            const level2Path = level2Node.fullPath;
            
            statusElement.textContent = `処理中: ${level2Path} (${completedCount + 1}/${level2Keys.length})`;
            
            // 該当するGeoJSONファイルのURLを抽出
            const geojsonUrls = extractGeoJSONUrls(csvText, level2Path);
            
            if (geojsonUrls.length === 0) {
                console.warn(`${level2Path} 配下にGeoJSONファイルが見つかりませんでした。`);
                completedCount++;
                continue;
            }
            
            // 各GeoJSONファイルを取得して結合
            const combinedFeatures = [];
            
            for (let i = 0; i < geojsonUrls.length; i++) {
                const url = geojsonUrls[i];
                
                try {
                    const geoResponse = await fetch(url);
                    if (geoResponse.ok) {
                        const geojson = await geoResponse.json();
                        if (geojson.features && Array.isArray(geojson.features)) {
                            combinedFeatures.push(...geojson.features);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to fetch ${url}:`, error);
                }
            }
            
            // 結合されたGeoJSONを作成
            const combinedGeoJSON = {
                type: "FeatureCollection",
                features: combinedFeatures
            };
            
            // ダウンロード
            const blob = new Blob([JSON.stringify(combinedGeoJSON, null, 2)], {
                type: 'application/json'
            });
            
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `${level1Path.replace(/\//g, '_')}_${level2Key}.geojson`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
            
            completedCount++;
            
            // 連続ダウンロードによるブラウザの負荷を軽減するため少し待機
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        statusElement.textContent = `分割ダウンロード完了: ${level1Path} の ${completedCount} 個のレベル2ディレクトリを処理しました`;
        statusElement.className = '';
        
    } catch (error) {
        console.error('Split download error:', error);
        const statusElement = document.getElementById('status');
        statusElement.textContent = `エラー: ${error.message}`;
        statusElement.className = 'error';
    }
}
