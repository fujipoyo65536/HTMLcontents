// todo
// 列数が合わない行
// UI調整 折りたたみ

// DOM読み込み後のイベント設定
document.addEventListener('DOMContentLoaded', function() {

	// // #inputOptions内のinputに変更があったらプレビューを更新
	// const inputOptions = document.getElementById('inputOptions');
	// inputOptions.addEventListener('input', function(){
	// 	updatePreview();
	// });
	// // #csvDataInputに変更があったらプレビューを更新
	// const csvDataInput = document.getElementById('csvDataInput');
	// csvDataInput.addEventListener('input', function(){
	// 	updatePreview();
	// });
	// // #previewCharLimitInputに変更があったらプレビューを更新
	// const previewCharLimitInput = document.getElementById('previewCharLimitInput');
	// previewCharLimitInput.addEventListener('input', function(){
	// 	updatePreview();
	// });

	// すべてのinput,textarea,selectに変更があったときの処理
	const inputElements = document.querySelectorAll('input,textarea,select');
	inputElements.forEach(function(element) {
		element.addEventListener('input', function(){
			updatePreview();
		});
	});

	// inputMethodに変更があったときの処理
	const inputMethodElements = document.getElementsByName('inputMethod');
	inputMethodElements.forEach(function(element) {
		element.addEventListener('change', function(){
			switch(element.value){
				case 'file':
					document.getElementById('csvFileInput').disabled = false;
					document.getElementById('inputDirectorySelectButton').disabled = true;
					document.getElementById('fileExtensionInput').disabled = true;
					document.getElementById('directoryReloadButton').disabled = true;
					document.getElementById('csvDataInput').disabled = true;
					break;

				case 'directory':
					document.getElementById('csvFileInput').disabled = true;
					document.getElementById('inputDirectorySelectButton').disabled = false;
					document.getElementById('fileExtensionInput').disabled = false;
					document.getElementById('directoryReloadButton').disabled = false;
					document.getElementById('csvDataInput').disabled = true;
					break;

				case 'direct':
					document.getElementById('csvFileInput').disabled = true;
					document.getElementById('inputDirectorySelectButton').disabled = true;
					document.getElementById('fileExtensionInput').disabled = true;
					document.getElementById('directoryReloadButton').disabled = true;
					document.getElementById('csvDataInput').disabled = false;
					break;
			}
		});
	});
	inputMethodElements[0].dispatchEvent(new Event('change'));


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
	// document.getElementById('csvDataInput').value = '1,2,3\n4,5,6\n7,"8",9\n"te""s""t1","te\nst2","te,st3"\nabc,def,ghi,jkl,mno\n\npqr,stu,vwx,yz\n';
	document.getElementById('csvDataInput').value = '列A,列B,列C\n1,2,3\n4,5,6,一列多い例\n7,8,9次行は空行\n\n"セル内に→""←セミコロン","セル内に→\n←改行","セル内に→,←カンマ"\n10,一列少ない例\n11,12,末尾に改行\n';
	updatePreview();
});

function updatePreview(){
	const limit = document.getElementById('previewCharLimitInput').value;
	const inputText = document.getElementById('csvDataInput').value.slice(0, limit);

	const csvArray = csvTextToArray(inputText,{
		delimiter: document.getElementById('delimiterInput').value || ',',
		lineBreakSelect: document.getElementById('lineBreakInput').value || 'ALL',
		skipRowNumber: document.getElementById('skipRowNumberInput').value || 0,
		skipEmptyRow: document.getElementById('skipEmptyRowCheckbox').checked || false,
		ignoreLastLineBreak: document.getElementById('ignoreLastLineBreakCheckbox').checked || false,
		isUsingHeader: document.getElementById('isUsingHeaderCheckbox').checked || false,
		wrapper: document.getElementById('wrapperInput').value || '"',
		isUsingWrapper: document.getElementById('isUsingWrapperCheckbox').checked || false,
		isUsingDelimiterInWrapper: document.getElementById('isUsingDelimiterInWrapperCheckbox').checked || false,
		isUsingWrapperInWrapper: document.getElementById('isUsingWrapperInWrapperCheckbox').checked || false,
		isUsingLineBreakInWrapper: document.getElementById('isUsingLineBreakInWrapperCheckbox').checked || false,
	});

	// 入力プレビュー
	const previewTableElement = document.getElementById('csvPreviewTable');
	viewTable(csvArray,previewTableElement);

	// 出力プレビュー
	const outputPreviewTableElement = document.getElementById('outputPreviewTable');
	// const outputLimit = document.getElementById('outputPreviewCharLimitInput').value;
	viewTable(csvArray,outputPreviewTableElement);

	// 出力テキスト
	let lineBreak
	switch(document.getElementById('outputLineBreakInput').value){
		case 'LF':
			lineBreak = '\n';
			break;
		case 'CR':
			lineBreak = '\r';
			break;
		case 'CRLF':
			lineBreak = '\r\n';
			break;
		default:
			lineBreak = '\n';
			break;
	}


	const outputText = ArrayToCsvText(csvArray,{
		delimiter: document.getElementById('outputDelimiterInput').value || ',',
		lineBreak,
		isUsingHeader: document.getElementById('outputIsUsingHeaderCheckbox').checked || false,
		wrapper: document.getElementById('outputWrapperInput').value || '"',
		isUsingWrapper: document.getElementById('outputIsUsingWrapperCheckbox').checked || false,
		isUsingWrapperAll: document.getElementById('outputIsUsingWrapperAllCheckbox').checked || false,
		isUsingSpecialCharacterInWrapper: document.getElementById('outputIsUsingSpecialCharacterInWrapperCheckbox').checked || false,
		addLastLineBreak: document.getElementById('outputAddLastLineBreakCheckbox').checked || false,
	});

	const csvDataOutputElement = document.getElementById('csvDataOutputTextarea');
	csvDataOutputElement.value = outputText;

}

function viewTable(csvArray,elem){
	// テーブルをクリア
	elem.innerHTML = '';

		// プレビューを表示
	if(csvArray.length == 0 || (csvArray.length == 1 && csvArray[0] == null)){
		elem.innerHTML = '<td>(データ無し)</td>';
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
		elem.appendChild(headerRow);
	}
	// データ行を表示
	for(let i = 1; i < csvArray.length; i++){
		let row = document.createElement('tr');
		csvArray[i].forEach(function(cell){
			let cellElement = document.createElement('td');
			cellElement.textContent = cell;
			row.appendChild(cellElement);
		});
		elem.appendChild(row);
	}
};

// csvTextToArray
function csvTextToArray(csvText,options={
		delimiter:',',
		lineBreakSelect:'ALL', // ALL,LF,CR,CRLF
		skipRowNumber:0,
		skipEmptyRow:false, 
		ignoreLastLineBreak:false,
		isUsingHeader:false,
		wrapper:'"',
		isUsingWrapper:false,
		isUsingDelimiterInWrapper:false,
		isUsingWrapperInWrapper:false,
		isUsingLineBreakInWrapper:false}){


	let lineBreak
	switch(options.lineBreakSelect){
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


	//入力末尾の改行を消す
	if(options.ignoreLastLineBreak){
		csvText = csvText.replace(/[\r\n|\r|\n]$/, '');
	}

	const rows = csvText.split(lineBreak);

	// 先頭行を読み飛ばして捨てる
	for(let i = 0; i < options.skipRowNumber; i++){
		rows.shift();
	}


	// 処理モードの決定(データの複雑さによる)
	// 1:最初に改行で分割し、その後デリミタで分割していいもの
	// 2:最初に改行で分割するが、先頭から各セルを判断する必要があるもの
	// 3:すべて1文字ずつ処理するもの

	let readingMode
	if(!options.isUsingWrapper){
		readingMode = 1;
	}else if(options.isUsingLineBreakInWrapper){
		readingMode = 3;
	}else if(options.isUsingDelimiterInWrapper){
		readingMode = 2;
	}else{
		readingMode = 1;
	}

	document.getElementById('readingModeView').textContent = `[debug]読み取りモード:${readingMode}`;//★

	let result=[];
	switch(readingMode){
		case 1:
			{
				if(!options.isUsingHeader){
					result[0] = null;
				}
				// それ以外の行を格納
				for(let i = 0; i < rows.length; i++){
					const rowData = rows[i].split(options.delimiter);
					if(options.skipEmptyRow && rowData.length == 1 && rowData[0] == ""){
						//行が空の場合はスキップ
						continue;
					}
					let row = [];
					for(let j = 0; j < rowData.length; j++){
						const cellData = rowData[j];
						let cell = cellData;
						// 両側の空白を削除
						cell = cell.trim();
						if(options.isUsingWrapper){
							// 両側の囲み文字を削除(囲み文字に両側を囲まれている場合のみ)
							// 両側が囲み文字かを確認
							if(cell.startsWith(options.wrapper) && cell.endsWith(options.wrapper)){
								// 両側を削除
								cell = cell.slice(1, -1);
								if(options.isUsingWrapperInWrapper){
									// 囲み文字の中の囲み文字をエスケープ
									cell = cell.replace(new RegExp(options.wrapper + options.wrapper, 'g'), options.wrapper);
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
				if(options.skipRowNumber > 0){
					splitText = rows.join("\n")
				}else{
					splitText = csvText.split("");
				}
				if(!options.isUsingHeader){
					result[0] = null;
				}
				let cell = "";
				let row = [];
				// ステータス関係
				let afterDelimiter = false;
				let afterLineBreak = true;
				let inWrapper = false;
				let afterWrapperCharacter = false; //ラッパー内でラッパーが1つ出てきたとき
				
				for(let i = 0; i < splitText.length; i++){
					const char = splitText[i];
					const lineBreakMatch = (char.match(lineBreak)||[null])[0];
					// ここから1文字ずつ処理していく
					if(inWrapper){
						switch(char){
							case options.wrapper:
								if(afterWrapperCharacter){
									afterWrapperCharacter = false;
									cell += char;
								}else{
									afterWrapperCharacter = true;
								}
								break;
							case options.delimiter:
								if(afterWrapperCharacter){
									inWrapper = false;
								}else{
									cell += char;
								}
								afterWrapperCharacter = false;
								break;
							case lineBreakMatch:
								if(afterWrapperCharacter){
									inWrapper = false;
								}else{
									cell += char;
								}
								afterWrapperCharacter = false;
								break;
							default:
								cell += char;
								afterWrapperCharacter = false;
								break;
						}
					}
					if(!inWrapper){
						switch(char){
							case options.wrapper:
								// ラッパーの外でラッパー文字が出てきたらおかしい。が淡々と追加
								if(afterDelimiter || afterLineBreak){
									inWrapper = true;
								}else{
									cell += char;
								}
								break;
							case options.delimiter:
								// デリミターが出てきたらセルを追加
								row.push(cell);
								cell = "";
								afterDelimiter = true;
								break;
							case lineBreakMatch:
								if(!afterLineBreak || !options.skipEmptyRow){ // 連続する改行は無視
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
						if(char != options.delimiter){
							afterDelimiter = false
						};
						if(char != lineBreakMatch){
							afterLineBreak = false
						};
						afterWrapperCharacter = false;
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

function ArrayToCsvText(array,options={
		delimiter:',',
		lineBreak:'\n',
		isUsingHeader:false,
		wrapper:'"',
		isUsingWrapper:false,
		isUsingWrapperAll:false,
		isUsingSpecialCharacterInWrapper:false,
		addLastLineBreak:false}){
	let result = "";

	// 先に、すべてのセルの特殊文字をチェック・置換
	if(options.isUsingWrapper && (options.isUsingSpecialCharacterInWrapper||options.isUsingWrapperAll) ){
		for([rowIndex,row] of array.entries()){
			if(row === null)continue;
			for([cellIndex,cell] of row.entries()){
				// if(options.isUsingWrapperAll || (cell.includes(options.wrapper)||cell.includes(options.delimiter)||cell.includes(options.lineBreak))){
				if(options.isUsingWrapperAll || (cell.includes(options.wrapper)||cell.includes(options.delimiter)||cell.includes("\n")||cell.includes("\r"))){ // 安全のため、CR・LFのいずれかがある場合はエスケープ
					array[rowIndex][cellIndex] = `${options.wrapper}${cell.replace(new RegExp(options.wrapper, 'g'), options.wrapper + options.wrapper)}${options.wrapper}`;
				}
			}
		}
	}

	// ヘッダー行を追加
	if(options.isUsingHeader){
		if(array[0]!=null){
			result += array[0].join(options.delimiter) + options.lineBreak;
		}else{
			console.error("入力にヘッダーがありませんが、ヘッダーを出力するよう指定されました。")
		}
	}

	// データ行を追加
	for(row=1; row<array.length; row++){
		result += array[row].join(options.delimiter) + options.lineBreak;
	}

	// 最後の改行を追加
	if(options.addLastLineBreak){
		result += options.lineBreak;
	}

	return result;
};