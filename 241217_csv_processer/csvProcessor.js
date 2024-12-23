// todo
// 空行を無視する
// 列数が合わない行

// DOM読み込み後のイベント設定
document.addEventListener('DOMContentLoaded', function() {

	// #loadingOptions内のinputに変更があったらプレビューを更新
	const loadingOptions = document.getElementById('loadingOptions');
	loadingOptions.addEventListener('input', function(){
		updatePreview();
	});
	// #csvDataInputに変更があったらプレビューを更新
	const csvDataInput = document.getElementById('csvDataInput');
	csvDataInput.addEventListener('input', function(){
		updatePreview();
	});
	// #previewCharLimitInputに変更があったらプレビューを更新
	const previewCharLimitInput = document.getElementById('previewCharLimitInput');
	previewCharLimitInput.addEventListener('input', function(){
		updatePreview();
	});

	// ファイルが入力されたら、いったん1ファイル目だけを読み込む
	const fileInput = document.getElementById('csvFileInput');
	fileInput.addEventListener('change', function(){
		const file = fileInput.files[0];
		const reader = new FileReader();
		reader.onload = function(){
			document.getElementById('csvDataInput').value = reader.result.slice(0, 20000);
			updatePreview();
		};
		reader.readAsText(file);
	});


	//デバッグ用
	document.getElementById('csvDataInput').value = '1,2,3\n4,5,6\n7,"8",9\n"te""s""t1","te\nst2","te,st3"\nabc,def,ghi,jkl,mno\n\npqr,stu,vwx,yz\n';
	updatePreview();
});

function updatePreview(){
	const limit = document.getElementById('previewCharLimitInput').value;
	const inputText = document.getElementById('csvDataInput').value.slice(0, limit);
	const previewTableElement = document.getElementById('csvPreviewTable');

	// プレビューを更新
	previewTableElement.innerHTML = '';

	const csvArray = csvTextToArray(inputText);
	if(csvArray.length == 0 || (csvArray.length == 1 && csvArray[0] == null)){
		previewTableElement.innerHTML = '<td>(データ無し)</td>';
		return;
	}
	//0行目がnullでないならヘッダー行を表示
	if(csvArray[0] !== null){
		let headerRow = document.createElement('tr');
		csvArray[0].forEach(function(cell){
			let headerCell = document.createElement('th');
			headerCell.textContent = cell;
			headerRow.appendChild(headerCell);
		});
		previewTableElement.appendChild(headerRow);
	}
	// データ行を表示
	for(let i = 1; i < csvArray.length; i++){
		let row = document.createElement('tr');
		csvArray[i].forEach(function(cell){
			let cellElement = document.createElement('td');
			cellElement.textContent = cell;
			row.appendChild(cellElement);
		});
		previewTableElement.appendChild(row);
	}
	
}

function csvTextToArray(csvText){
	const delimiter = document.getElementById('delimiterInput').value || ',';
	const lineBreakSelect = document.getElementById('lineBreakInput').value || 'ALL';
	let lineBreak
	switch(lineBreakSelect){
		case 'ALL':
			lineBreak = /[\r\n|\r|\n]/;
			break;
		case 'LF':
			lineBreak = /\n/;
			break;
		case 'CR':
			lineBreak = /\r/;
			break;
		case 'CRLF':
			lineBreak = /\r\n/;
			break;
		default:
			lineBreak = /\n/;
			break;
	}
	const skipRowNumber = document.getElementById('skipRowNumberInput').value || 0;
	const skipEmptyRow = document.getElementById('skipEmptyRowCheckbox').checked || false;
	const ignoreLastLineBreak = document.getElementById('ignoreLastLineBreakCheckbox').checked || false;
	const isHeader = document.getElementById('isHeaderCheckbox').checked || false;
	const wrapper = document.getElementById('wrapperInput').value || '"';

	//入力末尾の改行を消す
	if(ignoreLastLineBreak){
		csvText = csvText.replace(/[\r\n|\r|\n]$/, '');
	}

	const rows = csvText.split(lineBreak);
	// 先頭行を読み飛ばして捨てる
	for(let i = 0; i < skipRowNumber; i++){
		rows.shift();
	}


	// 処理モードの決定(データの複雑さによる)
	// 1:最初に改行で分割し、その後デリミタで分割していいもの
	// 2:最初に改行で分割するが、先頭から各セルを判断する必要があるもの
	// 3:すべて1文字ずつ処理するもの

	const isUseWrapper = document.getElementById('isUseWrapperCheckbox').checked || false;
	const isUseDelimiterInWrapper = document.getElementById('isUseDelimiterInWrapperCheckbox').checked || false;
	const isUseWrapperInWrapper = document.getElementById('isUseWrapperInWrapperCheckbox').checked || false;
	const isUseLineBreakInWrapper = document.getElementById('isUseLineBreakInWrapperCheckbox').checked || false;


	let readingMode
	if(!isUseWrapper){
		readingMode = 1;
	}else if(isUseLineBreakInWrapper){
		readingMode = 3;
	}else if(isUseDelimiterInWrapper){
		readingMode = 2;
	}else{
		readingMode = 1;
	}

	document.getElementById('readingModeView').textContent = `[debug]読み取りモード:${readingMode}`;//★

	let result=[];
	switch(readingMode){
		case 1:
			{
				if(!isHeader){
					result[0] = null;
				}
				// それ以外の行を格納
				for(let i = 0; i < rows.length; i++){
					const rowData = rows[i].split(delimiter);
					if(skipEmptyRow && rowData.length == 1 && rowData[0] == ""){
						//行が空の場合はスキップ
						continue;
					}
					let row = [];
					for(let j = 0; j < rowData.length; j++){
						const cellData = rowData[j];
						let cell = cellData;
						// 両側の空白を削除
						cell = cell.trim();
						if(isUseWrapper){
							// 両側の囲み文字を削除(囲み文字に両側を囲まれている場合のみ)
							// 両側が囲み文字かを確認
							if(cell.startsWith(wrapper) && cell.endsWith(wrapper)){
								// 両側を削除
								cell = cell.slice(1, -1);
								if(isUseWrapperInWrapper){
									// 囲み文字の中の囲み文字をエスケープ
									cell = cell.replace(new RegExp(wrapper + wrapper, 'g'), wrapper);
								}
							}								
						}
						// 結果に追加
						row.push(cell);
					}
					result.push(row);
				}
			}
			break;

		case 2:
			// 今作っていないのでレベル3で処理
		case 3:
			{
				let splitText;
				if(skipRowNumber > 0){
					splitText = rows.join("\n")
				}else{
					splitText = csvText.split("");
				}
				if(!isHeader){
					result[0] = null;
				}
				let cell = "";
				let row = [];
				// ステータス関係
				let afterDelimiter = false;
				let afterLineBreak = true;
				let inWrapper = false;
				let afterWrapperCharactor = false; //ラッパー内でラッパーが1つ出てきたとき
				
				for(let i = 0; i < splitText.length; i++){
					const char = splitText[i];
					const lineBreakMatch = (char.match(lineBreak)||[null])[0];
					// ここから1文字ずつ処理していく
					if(inWrapper){
						switch(char){
							case wrapper:
								if(afterWrapperCharactor){
									afterWrapperCharactor = false;
									cell += char;
								}else{
									afterWrapperCharactor = true;
								}
								break;
							case delimiter:
								if(afterWrapperCharactor){
									inWrapper = false;
								}else{
									cell += char;
								}
								afterWrapperCharactor = false;
								break;
							case lineBreakMatch:
								if(afterWrapperCharactor){
									inWrapper = false;
								}else{
									cell += char;
								}
								afterWrapperCharactor = false;
								break;
							default:
								cell += char;
								afterWrapperCharactor = false;
								break;
						}
					}
					if(!inWrapper){
						switch(char){
							case wrapper:
								// ラッパーの外でラッパー文字が出てきたらおかしい。が淡々と追加
								if(afterDelimiter || afterLineBreak){
									inWrapper = true;
								}else{
									cell += char;
								}
								break;
							case delimiter:
								// デリミターが出てきたらセルを追加
								row.push(cell);
								cell = "";
								afterDelimiter = true;
								break;
							case lineBreakMatch:
								if(!afterLineBreak || !skipEmptyRow){ // 連続する改行は無視
									// 改行が出てきたらセルを追加して行を追加
									row.push(cell);
									result.push(row);
									row = [];
									cell = "";
									afterLineBreak = true;
								}
								break;
							default:
								cell += char;
								break;
						}
						if(char != delimiter){
							afterDelimiter = false
						};
						if(char != lineBreakMatch){
							afterLineBreak = false
						};
						afterWrapperCharactor = false;
					}//if(inWrapper)
				}//1文字ずつ
				
				// 最後のセルを追加
				// if(cell != ""){
					row.push(cell);
				// }
				// if(row.length > 0){
					result.push(row);
				// }

			}
			break;
		}//switch
		console.log(result);
		return result; 
}