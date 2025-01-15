'use strict';

// 現状の問題
// 500MB程度のファイルでメモリオーバーで落ちる。uInt8ArrayToTextArrayが重い。というか出力される配列が相当に重い。そもそも配列の長さがオーバーしている気がする。
// 先頭スキップがうまく働いていない気がする


// todo
// 出力の大きさが大きい場合にOut Of Memoryになる問題の修正
// 入力が1ファイル500MBを超えるとOut Of Memoryになる問題の修正
// userFuncから触れる永続的な変数を準備
// 累積出力行数変数を追加
// perProcessFuncを追加→何につかうの?
// 列数が合わない行
// UI調整 折りたたみ
// ディレクトリの書き出し

// DOM読み込み後のイベント設定
document.addEventListener('DOMContentLoaded', function() {

	// すべてのinput,textarea,selectに変更があったときの処理
	const inputElements = document.querySelectorAll('input,textarea,select');
	inputElements.forEach(function(element) {
		element.addEventListener('input', function(){
			// inputEncodingSelectに変更があった場合はファイルをリロードする
			if(element.id == 'inputEncodingSelect'){
				csvProcessor.loadAndUpdatePreview();
			}else{
				csvProcessor.updatePreview();
			}
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
					document.getElementById('inputFileRegExpInput').disabled = true;
					document.getElementById('directoryReloadButton').disabled = true;
					document.getElementById('inputCsvTextInput').disabled = true;
					break;

				case 'directory':
					document.getElementById('selectFileButton').disabled = true;
					document.getElementById('inputDirectorySelectButton').disabled = false;
					document.getElementById('inputFileRegExpInput').disabled = false;
					document.getElementById('directoryReloadButton').disabled = false;
					document.getElementById('inputCsvTextInput').disabled = true;
					break;

				case 'direct':
					document.getElementById('selectFileButton').disabled = true;
					document.getElementById('inputDirectorySelectButton').disabled = true;
					document.getElementById('inputFileRegExpInput').disabled = true;
					document.getElementById('directoryReloadButton').disabled = true;
					document.getElementById('inputCsvTextInput').disabled = false;
					break;
			}
		});
	});
	inputMethodElements[0].dispatchEvent(new Event('change'));


	// ファイル入力イベント
	const fileInput = document.getElementById('selectFileButton');
	fileInput.addEventListener('change', function(){
		csvProcessor.inputFiles = [];
		for(const file of fileInput.files){
			csvProcessor.inputFiles.push({name:file.name,fileObj:file});
		}
		csvProcessor.loadAndUpdatePreview();
	});

	// ディレクトリ選択ボタンが押されたら、ディレクトリ選択ダイアログを開く
	const inputDirectorySelectButton = document.getElementById('inputDirectorySelectButton');
	inputDirectorySelectButton.addEventListener('click', async function(){
		csvProcessor.inputDirectoryHandle = await window.showDirectoryPicker();

		// ディレクトリ内で条件にあうファイルを検索(再帰的に)
		const searchRegExp = new RegExp(document.getElementById('inputFileRegExpInput').value);
		const searchFiles = async (directoryHandle,currentPath,searchRegExp) => {
			const files = [];
			// if(!currentPath)currentPath = `${directoryHandle.name}`;
			if(!currentPath)currentPath = "./";
			for await (const entry of directoryHandle.values()) {
				if(entry.kind === 'file' && searchRegExp.test(entry.name)){
					files.push({path:`${currentPath}${entry.name}`,name:entry.name,entry,fileObj:await entry.getFile()});
				}else if(entry.kind === 'directory'){
					const subFiles = await searchFiles(entry,`${currentPath}${entry.name}/`,searchRegExp);
					files.push(...subFiles);
				}
			}
			return files;
		};
		const files = await searchFiles(csvProcessor.inputDirectoryHandle,null,searchRegExp)
		csvProcessor.inputFiles = files;
		console.log(`${files.length} 件のファイルが見つかりました。`,files);
		csvProcessor.changeStatusText("inputDirectory",`${files.length} 件のファイルが見つかりました。`);
		csvProcessor.loadAndUpdatePreview();
	});

	// 出力ディレクトリ選択ボタンが押されたら、ディレクトリ選択ダイアログを開く
	const outputDirectorySelectButton = document.getElementById('outputDirectorySelectButton');
	outputDirectorySelectButton.addEventListener('click', async function(){
		csvProcessor.outputDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
		csvProcessor.changeStatusText("outputDirectory",`出力ディレクトリが設定されました:${csvProcessor.outputDirectoryHandle.name}`);
	});

	// 出力ボタン
	const outputButton = document.getElementById('outputButton');
	outputButton.addEventListener('click', async function(){
		csvProcessor.processAll();
	});
	




	//デバッグ用
	document.getElementById('inputCsvTextInput').value = '列A,列B,列C\n1,2,3\n4,5,6,一列多い例\n7,8,9次行は空行\n\n"セル内に→""←セミコロン","セル内に→\n←改行","セル内に→,←カンマ"\n10,一列少ない例\n11,12,末尾に改行\n';
	csvProcessor.updatePreview();
	
});

const csvProcessor = {

	settings:{
		outputBufferSize : 20_000_000, // 20M
	},

	loadAndUpdatePreview: async()=>{
		// 1ファイル目をプレビュー
		const options = csvProcessor.getOptionsFromHtml();
		const file = csvProcessor.inputFiles[0].fileObj;
		const reader = new FileReader();
		
		reader.onload = function(){
			const uint8Array = new Uint8Array(reader.result).slice(0, 100000);
			const inputEncoding = options.inputEncoding;
			let text;
			if(inputEncoding == 'AUTO'){
				const unicodeArray = Encoding.convert(uint8Array, {to: 'UNICODE',from: 'AUTO'});
				text = Encoding.codeToString(unicodeArray);
			}else{
				const decoder = new TextDecoder(inputEncoding);
				text = decoder.decode(uint8Array);
			}
			document.getElementById('inputCsvTextInput').value = text;
			csvProcessor.temporaryInputText = text;
			csvProcessor.updatePreview();
		};
		reader.readAsArrayBuffer(file);
	},

	updatePreview: ()=>{
		const options = csvProcessor.getOptionsFromHtml();

		const limit = document.getElementById('inputPreviewCharLimitInput').value*1;
		// const inputText = options.inputCsvText.slice(0, limit);
		const selectedInputMethod = document.querySelector('input[name="inputMethod"]:checked').value;
		let inputText;
		if (selectedInputMethod === 'file' || selectedInputMethod === 'directory') {
			inputText = (csvProcessor.temporaryInputText||"").slice(0, limit);
		} else {
			inputText = document.getElementById('inputCsvTextInput').value.slice(0, limit);
		}

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
		console.log("processAll Started");
		csvProcessor.changeStatusText("output","処理開始");

		const options = csvProcessor.getOptionsFromHtml();
		csvProcessor.options = options;
		csvProcessor.headerText = null;

		if(!csvProcessor.outputDirectoryHandle){
			csvProcessor.dialog("出力ディレクトリが選択されていません。");
			csvProcessor.changeStatusText("output","出力ディレクトリが選択されていません。");
			return;
		}

		let lineBreak
		switch(options.outputLineBreakSelect){
			case 'LF':
				csvProcessor.options.outputLineBreak = '\n';
				break;
			case 'CR':
				csvProcessor.options.outputLineBreak = '\r';
				break;
			case 'CRLF':
				csvProcessor.options.outputLineBreak = '\r\n';
				break;
			default:
				csvProcessor.options.outputLineBreak = '\n';
				break;
		}
		// csvProcessor.outputFilesWriteableStream = []; ★
		
		// ユーザー関数の準備
		// 入力ファイルごとに実行する処理
		{
			let perInputFunc = csvProcessor.makeUserFunc(document.querySelector("textarea[data-processOption='perInputCode']").value);
			if(typeof perInputFunc === 'function'){
				csvProcessor.perInputFunc = perInputFunc;
				csvProcessor.perInputFuncFlag = true;
			}else if(typeof perInputFunc === 'string'){
				csvProcessor.perInputFunc = undefined;
				console.log("入力ファイルごとに実行する処理は定義されませんでした",perInputFunc);
				csvProcessor.perInputFuncFlag = false;
			}
	
			// 行ごとに実行する処理
			let perRowFunc = csvProcessor.makeUserFunc(document.querySelector("textarea[data-processOption='perRowCode']").value);
			if(typeof perRowFunc === 'function'){
				csvProcessor.perRowFunc = perRowFunc;
				csvProcessor.perRowFuncFlag = true;
			}else if(typeof perRowFunc === 'string'){
				csvProcessor.perRowFunc = undefined;
				console.log("行ごとに実行する処理は定義されませんでした",perRowFunc);
				csvProcessor.perRowFuncFlag = false;
			}
			
			// セルごとに実行する処理
			let perCellFunc = csvProcessor.makeUserFunc(document.querySelector("textarea[data-processOption='perCellCode']").value);
			if(typeof perCellFunc === 'function'){
				csvProcessor.perCellFunc = perCellFunc;
				csvProcessor.perCellFuncFlag = true;
			}else if(typeof perCellFunc === 'string'){
				csvProcessor.perCellFunc = undefined;
				console.log("セルごとに実行する処理は定義されませんでした",perCellFunc);
				csvProcessor.perCellFuncFlag = false;
			}
	
			// 出力ファイル名を設定する処理
			let outputFileNameFunc = csvProcessor.makeUserFunc(options.outputFileNameCode);
			if(typeof outputFileNameFunc === 'function'){
				csvProcessor.outputFileNameFunc = outputFileNameFunc;
				csvProcessor.outputFileNameFuncFlag = true;
			}else if(typeof outputFileNameFunc === 'string'){
				csvProcessor.outputFileNameFunc = undefined;
				console.log("出力ファイル名を設定する処理は定義されませんでした",outputFileNameFunc);
				csvProcessor.outputFileNameFuncFlag = false;
			}
		}




		// 入力ファイルの読み込み
		csvProcessor.inputFileText = "";
		// csvProcessor.inputFileArray = [];
		// csvProcessor.inputFileRowTextArray = [];
		
		if(!csvProcessor.inputFiles || csvProcessor.inputFiles.length == 0){
			csvProcessor.dialog("入力ファイルが選択されていません。");
			return;
		}
		for(const [csvIndex,file] of csvProcessor.inputFiles.entries()){
			console.log(`input file loading: ${csvIndex}`,file);
			csvProcessor.changeStatusText("output",`ファイル読み込み中: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);

			//ファイル読み込みパート
			const fileObj = file.fileObj;
			const reader = new FileReader();

			// 同期で読み込み
			let csvTextArray; // 1文字ずつの配列
			if(options.inputEncoding == 'AUTO'){ // Encoding.jsを使って自動判定
				// 重いデータには対応しない
				reader.readAsArrayBuffer(fileObj);
				csvTextArray = await new Promise((resolve)=>{reader.onload = ()=>{
					const uint8Array = new Uint8Array(reader.result);
					const csvTextArray = Encoding.convert(uint8Array, {to: 'UNICODE',from: 'AUTO',type: 'array'}).map((code)=>String.fromCharCode(code));
					resolve(csvTextArray);
				}});
			}else{
				reader.readAsArrayBuffer(fileObj);
				csvTextArray = await new Promise((resolve)=>{reader.onload = ()=>{
					const uint8Array = new Uint8Array(reader.result);
					const csvTextArray = csvProcessor.uInt8ArrayToTextArray(uint8Array,options.inputEncoding);
					resolve(csvTextArray);
				}});
			}
			// 閉じる
			reader.abort();

			console.log(`input file loaded: ${csvIndex}`,file);
			csvProcessor.changeStatusText("output",`ファイル読み込み完了 加工処理開始: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);

			// 処理パート
			csvProcessor.inputFileTextObj = csvTextArray;
			const csvTextToArrayResult = csvProcessor.csvTextToArray(csvTextArray,{
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

			console.log(`input file processed: ${csvIndex}`,file);
			csvProcessor.changeStatusText("output",`ファイル加工処理完了: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);

			const csvArray = csvTextToArrayResult.arrayObj;
			const rowTextArray = csvTextToArrayResult.rowTextObj;
			// csvProcessor.inputFileArray = csvArray;
			// csvProcessor.inputFileRowTextArray = rowTextArray;
			// 処理と書き込み
			const csvArrayAfterProcess = await csvProcessor.processCsv(csvIndex,csvTextToArrayResult);
			// console.log(csvArrayAfterProcess);
			csvProcessor.changeStatusText("output",`ファイルのすべての処理が完了: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);

			//csvProcessorをクリーンにする
			csvProcessor.inputFileTextObj = null;
			csvProcessor.inputFileText = "";
		}// inputFileごと
		await csvProcessor.closeAllOutputStream();
		console.log("processAll Finished");
		csvProcessor.changeStatusText("output","すべての処理が完了");
	},

	processCsv: async(csvIndex,csvTextToArrayResult)=>{
		const csvFile = csvProcessor.inputFiles[csvIndex];
		console.log(`processCsv Started: ${csvIndex}`,csvFile);
		const csvArray = csvTextToArrayResult.arrayObj;
		const rowTextArray = csvTextToArrayResult.rowTextObj;
		const options = csvProcessor.options;
		const csvText = csvProcessor.inputFileText;
		// csvごとに行う処理
		// ユーザー処理
		if(csvProcessor.perInputFuncFlag){
			try{
				let tmp = csvProcessor.perInputFunc({
					file: csvFile,
					fileObj: csvFile.fileObj,
					csvIndex,
					csvText,
					csvArray,
					options,
					// csvProcessor
				});
			}
			catch(e){
				console.error(`入力ファイルごとに実行する処理の実行に失敗しました。`,e);
			}
		}
		for(let [rowIndex,rowArray] of csvArray.entries()){
			if(rowArray === null)continue;
			// 行ごとに行う処理
			const rowText = rowTextArray[rowIndex];
			// ユーザー処理
			if(csvProcessor.perRowFuncFlag){
				try{
					let tmp = csvProcessor.perRowFunc({
						file: csvFile,
						fileObj: csvFile.fileObj,
						csvIndex,
						csvText,
						csvArray,
						rowIndex,
						rowArray,
						rowText,
						options,
						// csvProcessor
					});
					if (Array.isArray(tmp)) {
						// csvArray[rowIndex] = tmp;
						rowArray = tmp;
					}
				}
				catch(e){
					console.error(`行ごとに実行する処理の実行に失敗しました。`,e);
				}
			}
			for(const [cellIndex,cellText] of rowArray.entries()){
				// セルごとに行う処理
				// ユーザー処理
				if(csvProcessor.perCellFuncFlag){
					try{
						let tmp = csvProcessor.perCellFunc({
							file: csvFile,
							fileObj: csvFile.fileObj,
							csvIndex,
							csvText,
							csvArray,
							rowIndex,
							rowArray,
							rowText,
							cellIndex,
							cellText,
							options,
							// csvProcessor
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

			// 出力
			const outputText = csvProcessor.rowArrayToCsvText(rowArray,{
				delimiter: options.outputDelimiter || ',',
				lineBreak: options.outputLineBreak || '\n',
				isUsingHeader: options.outputIsUsingHeader || false,
				wrapper: options.outputWrapper || '"',
				isUsingWrapper: options.outputIsUsingWrapper || false,
				isUsingWrapperAll: options.outputIsUsingWrapperAll || false,
				isUsingSpecialCharacterInWrapper: options.outputIsUsingSpecialCharacterInWrapper || false,
				addLastLineBreak: options.outputAddLastLineBreak || false,
			});
			if(rowIndex == 0){
				if(!csvProcessor.headerText){
					csvProcessor.headerText = outputText;
				}
			}else{

				let outputFileNames = ["output.csv"];
				if(csvProcessor.outputFileNameFuncFlag){
					try{
						let tmp = csvProcessor.outputFileNameFunc({
							file: csvFile,
							fileObj: csvFile.fileObj,
							csvIndex,
							csvText,
							csvArray,
							rowIndex,
							rowArray,
							rowText,
							options,
							// csvProcessor
						});
						if (typeof tmp === 'string') {
							outputFileNames = [tmp];
						} else if (Array.isArray(tmp)) {
							outputFileNames = tmp;
						}
					}
					catch(e){
						console.error(`出力ファイル名を設定する処理の実行に失敗しました。`,e);
					}
				}
				for(const outputFileName of outputFileNames){
					const outputFileFullName = `${outputFileName}`;
					// 出力ファイルに書き込み
					await csvProcessor.outputToFile(outputFileFullName,outputText);
				}
			}



		} // 行ごと
		console.log(`processCsv Finished: ${csvIndex}`,csvFile);
		return csvArray;
	},

	outputToFile: async (outputFileFullName,text)=>{
		// 出力ファイルのwriteableStreamが存在するかチェック
		if(!csvProcessor.outputFilesWriteableStream){
			csvProcessor.outputFilesWriteableStream = [];
		}
		let writeableStream;
		if(!csvProcessor.outputFilesWriteableStream[outputFileFullName]){
			// なければ作成
			console.log("File creating",outputFileFullName);
			csvProcessor.changeStatusText("output",`ファイル作成中: ${outputFileFullName}`);
			const fileHandle = await csvProcessor.outputDirectoryHandle.getFileHandle(outputFileFullName, {create: true});
			writeableStream = await fileHandle.createWritable();
			console.log("File created",outputFileFullName);
			csvProcessor.changeStatusText("output",`ファイル作成完了: ${outputFileFullName}`);
			csvProcessor.outputFilesWriteableStream[outputFileFullName] = writeableStream;
			if(!csvProcessor.outputFilesBuffer){csvProcessor.outputFilesBuffer = [];}
			csvProcessor.outputFilesBuffer[outputFileFullName] = "";

			// prefixを書き込み
			if(csvProcessor.options.outputPrefixText!=""){
				csvProcessor.outputFilesBuffer[outputFileFullName] += csvProcessor.options.outputPrefixText
			}
			// ヘッダーを書き込み
			if(csvProcessor.headerText){
				csvProcessor.outputFilesBuffer[outputFileFullName] += csvProcessor.headerText + csvProcessor.options.outputLineBreak;
			}
			// 1行目を書き込み
			csvProcessor.outputFilesBuffer[outputFileFullName] += text;

		}else{
			// あれば追記
			writeableStream = csvProcessor.outputFilesWriteableStream[outputFileFullName];
			csvProcessor.outputFilesBuffer[outputFileFullName] += csvProcessor.options.outputLineBreak + text;
		}

		if(csvProcessor.outputFilesBuffer[outputFileFullName].length > csvProcessor.settings.outputBufferSize){
			const arraybuffer = csvProcessor.encodeText(csvProcessor.outputFilesBuffer[outputFileFullName],csvProcessor.options.outputEncoding);
			await writeableStream.write(arraybuffer);
			csvProcessor.outputFilesBuffer[outputFileFullName] = "";
			console.log("File wrote",outputFileFullName);
			csvProcessor.changeStatusText("output",`ファイル書き込みを実施: ${outputFileFullName}`);
		}

	},

	closeAllOutputStream: async()=>{
		if(!csvProcessor.outputFilesWriteableStream || Object.keys(csvProcessor.outputFilesWriteableStream).length == 0){
			csvProcessor.dialog("出力ファイルが作成されませんでした。");
			return;
		}
		for(const [outputFileFullName,writeableStream] of Object.entries(csvProcessor.outputFilesWriteableStream)){
			// 改行を追加
			if(csvProcessor.options.outputAddLastLineBreak){
				csvProcessor.outputFilesBuffer[outputFileFullName] += csvProcessor.options.outputLineBreak;
			}

			// suffixTextを書き込み
			if(csvProcessor.options.outputSuffixText!=""){
				csvProcessor.outputFilesBuffer[outputFileFullName] += csvProcessor.options.outputSuffixText
			}

			// ストリーム書き込み
			const arraybuffer = csvProcessor.encodeText(csvProcessor.outputFilesBuffer[outputFileFullName],csvProcessor.options.outputEncoding);
			// writeableStream.write(arraybuffer); 
			// writeableStream.close(); 
			writeableStream.write(arraybuffer).then(()=>{
				writeableStream.close();
				console.log("File closed",outputFileFullName);
				csvProcessor.changeStatusText("output",`ファイルを閉じました: ${outputFileFullName}`);
			});

			// バッファを削除
			delete csvProcessor.outputFilesBuffer[outputFileFullName]
			delete csvProcessor.outputFilesWriteableStream[outputFileFullName];
		}
	},

	encodeText: (text,encode)=>{
		if(encode == 'UTF-8'){
			// UTF-8の場合はencoding.jsを使わない(たぶん遅いので)
			return new TextEncoder().encode(text);
		}else{
			const array = Encoding.convert(text, {to: encode, from: 'UNICODE', type: 'array'});
			const uint8Array = new Uint8Array(array);
			return uint8Array ;
		}
	},
	
	makeUserFunc: (userCode,args)=>{
		if(!userCode || userCode == ""){
			return "userFunc is empty";
		}
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

	csvTextToArray: (csvTextInput,options={
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

		// csvTextInputは文字列か、1文字ずつの配列(中身は文字)

		// ここからしばらく、入力は配列として扱う ★ダメ文字とかの面で問題のあるコード
		let csvTextArray = [];
		if (typeof csvTextInput === 'string') {
			csvTextArray = csvTextInput.split('')
		} else if (Array.isArray(csvTextInput)) {
			csvTextArray = csvTextInput;
		}

		let lineBreakRegExp;
		let lineBreak;
		switch(options.lineBreakSelect){
			case 'ALL':
				lineBreakRegExp = /[\r\n|\r|\n]/;
				lineBreak = '\r\n';
				break;
			case 'LF':
				lineBreakRegExp = /\n/;
				lineBreak = '\n';
				break;
			case 'CR':
				lineBreakRegExp = /\r/;
				lineBreak = '\r';
				break;
			case 'CRLF':
				lineBreakRegExp = /\r\n/;
				lineBreak = '\r\n';
				break;
			default:
				lineBreakRegExp = /\n/;
				lineBreak = '\n';
				break;
		}

		// 改行をLFに統一
		let tmpArray = [];
		for( let i = 0; i < csvTextArray.length; i++){
			if(csvTextArray[i] == '\r' && csvTextArray[i+1] == '\n'){
				// CRLFはLFに変換
				tmpArray.push('\n');
				i++;
			}else if(csvTextArray[i] == '\r'){
				// CRはLFに変換
				tmpArray.push('\n');
			}else{
				tmpArray.push(csvTextArray[i]);
			}
		}
		csvTextArray = tmpArray;


		//入力末尾の改行を消す
		if(options.ignoreLastLineBreak){
			if(csvTextArray[csvTextArray.length-1] == '\n'){
				csvTextArray.pop();
			}
		}

		// 先頭行を読み飛ばして捨てる
		if(options.skipRowNumber > 0){
			let tmpArray = [];
			let rowCount = 0;
			for( let i = 0; i < csvTextArray.length; i++){
				if(csvTextArray[i] == '\n'){
					rowCount++;
					if(rowCount >= options.skipRowNumber){
						tmpArray.push(csvTextArray[i]);
					}
				}
			}
			csvTextArray = tmpArray;
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
					// 行に分割
					let rows = csvProcessor.splitTextArray(csvTextArray, "\n", "String");

					// ヘッダー行が無い場合はnullを格納
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
					//1文字ずつ細切れのArrayを生成
					let splitTextArray = csvTextArray;

					// ヘッダー行が無い場合はnullを格納
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
					
					for(let i = 0; i < splitTextArray.length; i++){
						rowText += splitTextArray[i];
						const char = splitTextArray[i];
						const lineBreakMatch = (char.match(lineBreakRegExp)||[null])[0];
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
		// console.log(arrayObj);
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

	rowArrayToCsvText: (rowArray,options={
		delimiter:',',
		lineBreak:'\n',
		isUsingHeader:false,
		wrapper:'"',
		isUsingWrapper:false,
		isUsingWrapperAll:false,
		isUsingSpecialCharacterInWrapper:false,
		addLastLineBreak:false})=>{

		// 先に、すべてのセルの特殊文字をチェック・置換
		if(options.isUsingWrapper && (options.isUsingSpecialCharacterInWrapper||options.isUsingWrapperAll) ){
			for(const [cellIndex,cell] of row.entries()){
				if(options.isUsingWrapperAll || (cell.includes(options.wrapper)||cell.includes(options.delimiter)||cell.includes("\n")||cell.includes("\r"))){ // 安全のため、CR・LFのいずれかがある場合はエスケープ
					array[rowIndex][cellIndex] = `${options.wrapper}${cell.replace(new RegExp(options.wrapper, 'g'), options.wrapper + options.wrapper)}${options.wrapper}`;
				}
			}
		}

		return rowArray.join(options.delimiter);
	},

	dialog: (message)=>{
		alert(message);
	},

	changeStatusText: (type,message)=>{
		document.getElementById(`${type}StatusText`).textContent = message;
	},

	splitTextArray: (inputTextData,delimiter,returnType)=>{
		// delimiterは2文字までに対応
	
		// まずは1文字ずつの配列に変える
		// 文字列だったら、1文字ずつの配列に変える
		let textArray = [];
		if (typeof inputTextData === 'string') {
			textArray = inputTextData.split('');
		} else if (Array.isArray(inputTextData)) {
			textArray = inputTextData; // 配列だったらそのまま
		}

		let resultArray = [];
		let cellArray	= [];
		if(delimiter.length == 1){
			for(let i = 0; i < textArray.length; i++){
				if(textArray[i] == delimiter){
					resultArray.push(cellArray);
					cellArray = [];
				}else{
					cellArray.push(textArray[i]);
				}
			}
		}else if(delimiter.length == 2){
			for(let i = 0; i < textArray.length; i++){
				if(textArray[i] == delimiter[0] && textArray[i+1] == delimiter[1]){
					resultArray.push(cellArray);
					cellArray = [];
					i++;
				}else{
					cellArray = textArray[i];
				}
			}
		}
		// 最後のセルを追加
		resultArray.push(cellArray);

		switch(returnType){
			case 'String':
				return resultArray.map(cellArray => cellArray.join(''));
			case 'Array':
				return resultArray;

		}

	},

	uInt8ArrayToTextArray: (uInt8Array,encode)=>{
		// マルチバイト文字に対応しつつ、1文字ずつの配列に変換
		// 文字コードのデコードもする

		// まず、配列をある程度の流さに分割する。
		// ただし文字コードごとに、マルチバイト文字の途中では分割しないようにする。
		let textArrays = []; // 分割後テキスト
		const limit = 100_000;
		let textArray = []; // 分割前テキスト配列(中身はテキスト)
		for(let i = 0; i < uInt8Array.length; i++){
			textArray.push(uInt8Array[i]);
			if(textArray.length >= limit){
				// encodeごとに、区切って良い位置かを判定
				let breakSafeFlag
				switch(encode){
					case 'utf-8':
					case 'euc-jp':
						//1バイト文字(の直後)なら区切ってOK
						if(uInt8Array[i] < 0x80){
							breakSafeFlag = true;
						}else{
							breakSafeFlag = false;
						}
						break;

					case 'shift-jis':
						//2バイト文字の1バイト目は区切ってはダメ
						if(uInt8Array[i] >= 0x81 && uInt8Array[i] <= 0x9f || uInt8Array[i] >= 0xe0 && uInt8Array[i] <= 0xfc){
							breakSafeFlag = false;
						}else{
							breakSafeFlag = true;
						}
						break;

					case 'iso-2022-jp':
						//マルチバイト文字の場合は(1文字目でも2文字目でも)区切ってはいけない
						if(uInt8Array[i] >= 0x21 && uInt8Array[i] <= 0x7e){
							breakSafeFlag = false;
						}else{
							breakSafeFlag = true;
						}
						break;

					case 'utf-16':
					case 'utf-16be':
						//奇数文字目の文字は区切ってはいけない
						//例:i=0はダメ i=1はOK
						if(i % 2 == 1){
							//サロゲートペアは区切ったらダメ
							if(uInt8Array[i-1] >= 0xd8 && uInt8Array[i-1] <= 0xdf){
								breakSafeFlag = false;
							}else{
								breakSafeFlag = true;
							}
						}else{
							breakSafeFlag = false;
						}
						break;
					case 'utf-16le':
						//奇数文字目の文字は区切ってはいけない
						//例:i=0はダメ i=1はOK
						if(i % 2 == 1){
							//サロゲートペアは区切ったらダメ
							if(uInt8Array[i] >= 0xd8 && uInt8Array[i] <= 0xdf){
								breakSafeFlag = false;
							}else{
								breakSafeFlag = true;
							}
						}else{
							breakSafeFlag = false;
						}
						break;
				}
				if(breakSafeFlag){
					textArrays.push(textArray);
					textArray = [];
				}
			}
		}
		textArrays.push(textArray);

		// それぞれのtextArrayをデコードして文字列にする配列にして結合する
		let resultArray = [];
		for(let textArray of textArrays){
			let uInt8Array = new Uint8Array(textArray);
			let text = new TextDecoder(encode).decode(uInt8Array);
			// 1文字ずつの配列に変換
			let textArrayEncoded = text.split('');
			resultArray = resultArray.concat(textArrayEncoded);
		}

		return resultArray;
	},

	

	// encodeToSjis: (content)=>{
	// 	// from:https://qiita.com/dopperi46/items/49441391fa0e3beae3da
	// 	let buffer = [];
	// 	for (let i = 0; i < content.length; i++) {
	// 		const c = content.codePointAt(i);
	// 		if (c > 0xffff) {
	// 				i++;
	// 		}
	// 		if (c < 0x80) {
	// 				buffer.push(c);
	// 		}
	// 		else if (c >= 0xff61 && c <= 0xff9f) {
	// 				buffer.push(c - 0xfec0);
	// 		}
	// 		else {
	// 			const d = this.sjisEncodeTable[String.fromCodePoint(c)] || 0x3f;
	// 			if (d > 0xff) {
	// 					buffer.push(d >> 8 & 0xff, d & 0xff);
	// 			}
	// 			else {
	// 					buffer.push(d);
	// 			}
	// 		}
	// 	}
	// 	return Uint8Array.from(buffer);
	// },

}

// エンコード用テーブル生成
// {
// 	csvProcessor.sjisEncodeTable = { '\u00a5': 0x5c, '\u203e': 0x7e, '\u301c': 0x8160 };
// 	const decoder = new TextDecoder('shift-jis');
// 	for (let i = 0x81; i <= 0xfc; i++) {
// 			if (i <= 0x84 || i >= 0x87 && i <= 0x9f || i >= 0xe0 && i <= 0xea || i >= 0xed && i <= 0xee || i >= 0xfa) {
// 					for (let j = 0x40; j <= 0xfc; j++) {
// 							const c = decoder.decode(new Uint8Array([i, j]));
// 							if (c.length === 1 && c !== '\ufffd' && !csvProcessor.sjisEncodeTable[c]) {
// 									csvProcessor.sjisEncodeTable[c] = i << 8 | j;
// 							}
// 					}
// 			}
// 	}
// }