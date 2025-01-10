'use strict';

// todo
// 列数が合わない行
// UI調整 折りたたみ
// 文字コード変換

// DOM読み込み後のイベント設定
document.addEventListener('DOMContentLoaded', function() {

	// すべてのinput,textarea,selectに変更があったときの処理
	const inputElements = document.querySelectorAll('input,textarea,select');
	inputElements.forEach(function(element) {
		element.addEventListener('input', function(){
			csvProcessor.updatePreview();
		});
	});

	// inputMethodに変更があったときの処理
	const inputMethodElements = document.getElementsByName('inputMethod');
	inputMethodElements.forEach(function(element) {
		element.addEventListener('change', function(){
			switch(element.value){
				case 'file':
					document.getElementById('selectFileButton').disabled = false;
					document.getElementById('inputDirectorySelectButton').disabled = true;
					document.getElementById('inputFileExtensionInput').disabled = true;
					document.getElementById('directoryReloadButton').disabled = true;
					document.getElementById('inputCsvTextInput').disabled = true;
					break;

				case 'directory':
					document.getElementById('selectFileButton').disabled = true;
					document.getElementById('inputDirectorySelectButton').disabled = false;
					document.getElementById('inputFileExtensionInput').disabled = false;
					document.getElementById('directoryReloadButton').disabled = false;
					document.getElementById('inputCsvTextInput').disabled = true;
					break;

				case 'direct':
					document.getElementById('selectFileButton').disabled = true;
					document.getElementById('inputDirectorySelectButton').disabled = true;
					document.getElementById('inputFileExtensionInput').disabled = true;
					document.getElementById('directoryReloadButton').disabled = true;
					document.getElementById('inputCsvTextInput').disabled = false;
					break;
			}
		});
	});
	inputMethodElements[0].dispatchEvent(new Event('change'));


	// ファイルが入力されたら、いったん1ファイル目だけを読み込む
	const fileInput = document.getElementById('selectFileButton');
	fileInput.addEventListener('change', function(){
		csvProcessor.inputFiles = [];
		for(const file of fileInput.files){
			csvProcessor.inputFiles.push(file);
		}

		// 1ファイル目をプレビュー
		const file = csvProcessor.inputFiles[0];
		const reader = new FileReader();
		reader.onload = function(){
			document.getElementById('inputCsvTextInput').value = reader.result.slice(0, 20000);
			csvProcessor.updatePreview();
		};
		reader.readAsText(file);
		
	});


	//デバッグ用
	document.getElementById('inputCsvTextInput').value = '列A,列B,列C\n1,2,3\n4,5,6,一列多い例\n7,8,9次行は空行\n\n"セル内に→""←セミコロン","セル内に→\n←改行","セル内に→,←カンマ"\n10,一列少ない例\n11,12,末尾に改行\n';
	csvProcessor.updatePreview();
});

const csvProcessor = {

	updatePreview: ()=>{
		const options = csvProcessor.getOptionsFromHtml();

		const limit = document.getElementById('inputPreviewCharLimitInput').value*1;
		const inputText = options.inputCsvText.slice(0, limit);

		const csvTextToArrayResult = csvProcessor.csvTextToArray(inputText,{
			delimiter: options.inputDelimiter || ',',
			lineBreakSelect: options.inputLineBreakSelect || 'ALL', // ALL,LF,CR,CRLF
			skipRowNumber: options.inputSkipRowNumber || 0,
			skipEmptyRow: options.inputSkipEmptyRow || false,
			ignoreLastLineBreak: options.inputIgnoreLastLineBreak || false,
			isUsingHeader: options.inputIsUsingHeader || false,
			wrapper: options.inputWrapper || '"',
			isUsingWrapper: options.inputIsUsingWrapper || false,
			isUsingDelimiterInWrapper: options.inputIsUsingDelimiterInWrapper || false,
			isUsingWrapperInWrapper: options.inputIsUsingWrapperInWrapper || false,
			isUsingLineBreakInWrapper: options.inputIsUsingLineBreakInWrapper || false,
		});

		const csvArray = csvTextToArrayResult.arrayObj;
		const rowTextArray = csvTextToArrayResult.rowTextObj;

		// 入力プレビュー
		const previewTableElement = document.getElementById('inputPreviewTable');
		csvProcessor.viewTable(csvArray,previewTableElement);

		// 出力プレビュー
		const outputPreviewTableElement = document.getElementById('outputPreviewTable');
		csvProcessor.viewTable(csvArray,outputPreviewTableElement);

		// 出力テキスト
		let lineBreak
		switch(options.outputLineBreakSelect){
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

		const outputText = csvProcessor.arrayToCsvText(csvArray,{
			delimiter: options.outputDelimiter || ',',
			lineBreak,
			isUsingHeader: options.outputIsUsingHeader || false,
			wrapper: options.outputWrapper || '"',
			isUsingWrapper: options.outputIsUsingWrapper || false,
			isUsingWrapperAll: options.outputIsUsingWrapperAll || false,
			isUsingSpecialCharacterInWrapper: options.outputIsUsingSpecialCharacterInWrapper || false,
			addLastLineBreak: options.outputAddLastLineBreak || false,
		});

		const csvDataOutputElement = document.getElementById('csvTextOutputTextarea');
		csvDataOutputElement.value = outputText;

	},

	processAll: async()=>{
		const options = csvProcessor.getOptionsFromHtml();

		// ユーザー関数の準備
		let perCellFunc = csvProcessor.makeUserFunc(document.querySelector("textarea[data-processOption='perCellCode']").value);
		if(typeof perCellFunc === 'function'){
			csvProcessor.perCellFunc = perCellFunc;
			csvProcessor.perCellFuncFlag = true;
		}else if(typeof perCellFunc === 'string'){
			csvProcessor.perCellFunc = undefined;
			console.error("セルごとに実行する処理の定義に失敗しました。",perCellFunc);
			csvProcessor.perCellFuncFlag = false;
		}

		// 入力ファイルの読み込み
		csvProcessor.inputFilesText = [];
		csvProcessor.inputFilesArray = [];
		csvProcessor.inputFilesRowTextArray = [];
		for(const [csvIndex,file] of csvProcessor.inputFiles.entries()){
			const reader = new FileReader();
			// 同期で読み込み
			reader.readAsText(file);
			const csvText = await new Promise((resolve)=>{reader.onload = ()=>{resolve(reader.result)}});
			console.log(csvText);
			// 処理
			csvProcessor.inputFilesText.push(csvText);
			const csvTextToArrayResult = csvProcessor.csvTextToArray(csvText,{
				delimiter: options.inputDelimiter || ',',
				lineBreakSelect: options.inputLineBreakSelect || 'ALL', // ALL,LF,CR,CRLF
				skipRowNumber: options.inputSkipRowNumber || 0,
				skipEmptyRow: options.inputSkipEmptyRow || false,
				ignoreLastLineBreak: options.inputIgnoreLastLineBreak || false,
				isUsingHeader: options.inputIsUsingHeader || false,
				wrapper: options.inputWrapper || '"',
				isUsingWrapper: options.inputIsUsingWrapper || false,
				isUsingDelimiterInWrapper: options.inputIsUsingDelimiterInWrapper || false,
				isUsingWrapperInWrapper: options.inputIsUsingWrapperInWrapper || false,
				isUsingLineBreakInWrapper: options.inputIsUsingLineBreakInWrapper || false,
			})
			const csvArray = csvTextToArrayResult.arrayObj;
			const rowTextArray = csvTextToArrayResult.rowTextObj;
			csvProcessor.inputFilesArray.push(csvArray);
			csvProcessor.inputFilesRowTextArray.push(rowTextArray);
			csvProcessor.processCsv(csvIndex,csvTextToArrayResult);
		}
	},

	processCsv: (csvIndex,csvTextToArrayResult)=>{
		const csvArray = csvTextToArrayResult.arrayObj;
		const rowTextArray = csvTextToArrayResult.rowTextObj;
		const options = csvProcessor.getOptionsFromHtml();
		const csvText = csvProcessor.inputFilesText[csvIndex];
		// csvごとに行う処理


		for(const [rowIndex,rowArray] of csvArray.entries()){
			if(rowArray === null)continue;
			// 行ごとに行う処理
			const rowText = rowTextArray[rowIndex];
			for(const [cellIndex,cellText] of rowArray.entries()){
				// セルごとに行う処理
				options.cellText = cellText;
				if(csvProcessor.perCellFuncFlag){
					try{
						let tmp = csvProcessor.perCellFunc({
							csvIndex,
							csvText,
							csvArray,
							rowIndex,
							rowArray,
							rowText,
							cellIndex,
							cellText,
							options,
							csvProcessor
						});
						// 戻り値が文字列であれば、cellDataを上書き
						switch(typeof tmp){
							case 'string':
								csvArray[rowIndex][cellIndex] = tmp;
								break;
							case 'number':
								csvArray[rowIndex][cellIndex] = tmp.toString();
								break;
							case 'boolean':
								csvArray[rowIndex][cellIndex] = tmp.toString();
								break;
						};
					}
					catch(e){
						console.error(`セルごとに実行する処理の実行に失敗しました。`,e);
					}
				}
			} // セルごと
		} // 行ごと
		console.log(csvArray);
	},

	makeUserFunc: (userCode,args)=>{
		let code= `try{\n${userCode}\n}catch(e){console.log("userFunc failed:",e.message);console.error(e);}`;
		let func;
		try{
			func = new Function("a",code);
		}catch(e){
			console.log("makeUserFunc Failed:",e);
			return e.message;
		}
		return func;
	},

	viewTable: (csvArray,elem)=>{
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
	},

	getOptionsFromHtml: ()=>{
		let options = {}
		// HTMLから各オプションの値を取得して格納
		// HTMLの[data-option]属性を持つ要素を取得

		const optionElements = document.querySelectorAll('[data-option]');
		optionElements.forEach(function(element){
			const key = element.dataset.option;
			const value = element.value;

			// type属性によって適切に処理する
			switch(element.type){
				case 'checkbox':
					options[key] = element.checked;
					break;
				case 'number':
					options[key] = Number(value);
					break;
				default:
					options[key] = value;
					break;
			}
		});

		return options;
	},

	csvTextToArray: (csvText,options={
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
			isUsingLineBreakInWrapper:false})=>{


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

		let arrayObj=[];
		let rowTextObj=[];
		switch(readingMode){
			case 1:
				{
					if(!options.isUsingHeader){
						arrayObj[0] = null;
						rowTextObj[0] = null;
					}
					// それ以外の行を格納
					for(let i = 0; i < rows.length; i++){
						rowTextObj.push(rows[i]);
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
						arrayObj.push(row);
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
						arrayObj[0] = null;
						rowTextObj[0] = null;
					}
					let cell = "";
					let row = [];
					let rowText = "";
					// ステータス関係
					let afterDelimiter = false;
					let afterLineBreak = true;
					let inWrapper = false;
					let afterWrapperCharacter = false; //ラッパー内でラッパーが1つ出てきたとき
					
					for(let i = 0; i < splitText.length; i++){
						rowText += splitText[i];
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
										arrayObj.push(row);
										row = [];
										cell = "";
										rowTextObj.push(rowText);
										rowText = "";
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
					row.push(cell);
					arrayObj.push(row);
					rowTextObj.push(rowText);
				}
				break;
		}//switch
		console.log(arrayObj);
		return {arrayObj,rowTextObj};
	},

	arrayToCsvText: (array,options={
		delimiter:',',
		lineBreak:'\n',
		isUsingHeader:false,
		wrapper:'"',
		isUsingWrapper:false,
		isUsingWrapperAll:false,
		isUsingSpecialCharacterInWrapper:false,
		addLastLineBreak:false})=>{
	let result = "";

	// 先に、すべてのセルの特殊文字をチェック・置換
	if(options.isUsingWrapper && (options.isUsingSpecialCharacterInWrapper||options.isUsingWrapperAll) ){
		for(const [rowIndex,row] of array.entries()){
			if(row === null)continue;
			for(const [cellIndex,cell] of row.entries()){
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
	for(let row=1; row<array.length; row++){
		result += array[row].join(options.delimiter) + options.lineBreak;
	}

	// 最後の改行を追加
	if(options.addLastLineBreak){
		result += options.lineBreak;
	}

	return result;
	},

}