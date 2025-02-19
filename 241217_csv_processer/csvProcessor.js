'use strict';

// ●現状の問題
// BOMをうまく扱えない
// 複雑なCSVが読めなくなっている気がする
// プレビュー周りの実装が全体的によくない。文字コードを選択するとエラーになる。
// 文字コード自動判定も動いているのか怪しい
// 各テキスト欄が長いとレイアウトが崩れる

// ●todo
// カスタム改行文字に対応
// tooltip
// 列数が合わない行の扱い
// UI調整 折りたたみ
// ディレクトリの書き出し
// プロファイル読込・書き出しの改善・削除機能
// 強制的な処理の打ち切り

// ●やる気がないもの
// perProcessFuncを追加 →使い道が思いつかないので保留
// 累積出力行数
// perInputFunc → sort
// perRowFunc → select
// perCellFunc → (replace,upper,lower,substring)



// DOM読み込み後のイベント設定
document.addEventListener('DOMContentLoaded', function() {
	
	// codemirror
	{
		csvProcessor.editors = {};
		csvProcessor.editors.inputText = CodeMirror.fromTextArea(document.getElementById('inputCsvTextInput'), {
			lineNumbers: true,
			mode: "javascript",
			theme: "default",
			lineWrapping: true,
			showCursorWhenSelecting: true,
			pasteLinesPerSelection: true,
		});
		csvProcessor.editors.inputText.setValue('列A,列B,列C\n1,2,3\n4,5,6,一列多い例\n7,8,9次行は空行\n\n"セル内に→""←セミコロン","セル内に→\n←改行","セル内に→,←カンマ"\n10,一列少ない例\n11,12,末尾に改行\n')
		// editor.setValue("// Input Code Here;\n")

		csvProcessor.editors.outputText = CodeMirror.fromTextArea(document.getElementById('csvTextOutputTextarea'), {
			lineNumbers: true,
			mode: "javascript",
			theme: "default",
			lineWrapping: true,
			showCursorWhenSelecting: true,
			pasteLinesPerSelection: true,
		});

		csvProcessor.editors.perInputCode = CodeMirror.fromTextArea(document.getElementById('perInputCode'), {
			lineNumbers: true,
			mode: "javascript",
			theme: "default",
			lineWrapping: true,
			showCursorWhenSelecting: true,
			lineWiseCopyCut: true,
			pasteLinesPerSelection: true,
		});
		csvProcessor.editors.perInputCode.setValue('//example\n//return [];\n');

		csvProcessor.editors.perRowCode = CodeMirror.fromTextArea(document.getElementById('perRowCode'), {
			lineNumbers: true,
			mode: "javascript",
			theme: "default",
			lineWrapping: true,
			showCursorWhenSelecting: true,
			lineWiseCopyCut: true,
			pasteLinesPerSelection: true,
		});
		csvProcessor.editors.perRowCode.setValue('//example\n//return [];\n');

		csvProcessor.editors.perCellCode = CodeMirror.fromTextArea(document.getElementById('perCellCode'), {
			lineNumbers: true,
			mode: "javascript",
			theme: "default",
			lineWrapping: true,
			showCursorWhenSelecting: true,
			lineWiseCopyCut: true,
			pasteLinesPerSelection: true,
		});
		csvProcessor.editors.perCellCode.setValue('//example\n//return cellText;\n');

		csvProcessor.editors.perOutputCode = CodeMirror.fromTextArea(document.getElementById('perOutputCode'), {
			lineNumbers: true,
			mode: "javascript",
			theme: "default",
			lineWrapping: true,
			showCursorWhenSelecting: true,
			lineWiseCopyCut: true,
			pasteLinesPerSelection: true,
		});
		csvProcessor.editors.perOutputCode.setValue('//example\n//return [];\n');
	}

	
	// タブ関係
	const previewPaneTabs = document.querySelectorAll('#previewPaneTabBox>.tab');
	const previewPaneContents = document.querySelectorAll('#previewPaneContentBox>.tabContent');
	previewPaneTabs.forEach(function(tab, tabIndex) {
		tab.addEventListener('click', function() {
			previewPaneTabs.forEach(function(tab) {
				tab.classList.remove('active');
			});
			previewPaneContents.forEach(function(content) {
				content.style.display = 'none';
			});
			tab.classList.add('active');
			previewPaneContents[tabIndex].style.display = 'block';
		});
	});
	previewPaneTabs[0].click();
	
	const codePaneTabs = document.querySelectorAll('#codePaneTabBox>.tab');
	const codePaneContents = document.querySelectorAll('#codePaneContentBox>.tabContent');
	codePaneTabs.forEach(function(tab,tabIndex){
		tab.addEventListener('click', function() {
			codePaneTabs.forEach(function(tab) {
				tab.classList.remove('active');
			});
			codePaneContents.forEach(function(content) {
				content.style.display = 'none';
			});
			tab.classList.add('active');
			codePaneContents[tabIndex].style.display = 'block';
		});
	});
	codePaneTabs[2].click();
	
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
			if(!document.querySelector('input[name="inputMethod"]:checked'))return;
			let value = document.querySelector('input[name="inputMethod"]:checked').value;
			switch(value){
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
		// csvProcessor.processAll();
		csvProcessor.processAllStream();
	});
	
	// プロファイル系
	csvProcessor.listLocalProfiles();
	// プロファイルエクスポート
	const exportProfileButton = document.getElementById('profileExportButton');
	exportProfileButton.addEventListener('click', async function(){
		csvProcessor.exportProfile();
	});
	
	// プロファイルインポート
	const importProfileButton = document.getElementById('profileImportButton');
	importProfileButton.addEventListener('click', async function(){
		csvProcessor.importProfile();
	});
	
	// プロファイル保存
	const saveProfileButton = document.getElementById('profileSaveButton');
	saveProfileButton.addEventListener('click', async function(){
		csvProcessor.saveProfile();
	});
	
	// プロファイル読込
	const loadProfileButton = document.getElementById('profileLoadButton');
	loadProfileButton.addEventListener('click', async function(){
		csvProcessor.loadProfile();
	});
	
	// プロファイル削除
	const removeProfileButton = document.getElementById('profileRemoveButton');
	removeProfileButton.addEventListener('click', async function(){
		csvProcessor.removeProfile();
	});
	
	
	
	
	//デバッグ用
	document.getElementById('inputCsvTextInput').value = '列A,列B,列C\n1,2,3\n4,5,6,一列多い例\n7,8,9次行は空行\n\n"セル内に→""←セミコロン","セル内に→\n←改行","セル内に→,←カンマ"\n10,一列少ない例\n11,12,末尾に改行\n';
	csvProcessor.updatePreview();
	
});

const csvProcessor = {
	version: 1,
	
	inputFiles: {},
	outputFiles: {},
	
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
			lineBreakSelect: options.inputLineBreakSelect=="CUSTOM"?options.inputLineBreakCustom:options.inputLineBreakSelect,
			skipRowNumber: options.inputSkipRowNumber || 0,
			skipEmptyRow: options.inputSkipEmptyRow || false,
			ignoreLastLineBreak: options.inputIgnoreLastLineBreak || false,
			isUsingHeader: options.inputIsUsingHeader || false,
			wrapper: options.inputWrapper || '"',
			isUsingWrapper: options.inputIsUsingWrapper || false,
			isUsingDelimiterInWrapper: options.inputIsUsingDelimiterInWrapper || false,
			isUsingWrapperInWrapper: options.inputIsUsingWrapperInWrapper || false,
			isUsingLineBreakInWrapper: options.inputIsUsingLineBreakInWrapper || false,
			first:true,
			last:true,
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
		csvProcessor.addLogText("output","処理開始");
		
		const options = csvProcessor.getOptionsFromHtml();
		csvProcessor.options = options;
		csvProcessor.headerText = null;
		
		if(!csvProcessor.outputDirectoryHandle){
			csvProcessor.dialog("出力ディレクトリが選択されていません。");
			csvProcessor.addLogText("output","出力ディレクトリが選択されていないため処理中断");
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
			
			// 出力ファイルごとに実行する処理
			let perOutputFunc = csvProcessor.makeUserFunc(document.querySelector("textarea[data-processOption='perOutputCode']").value);
			if(typeof perOutputFunc === 'function'){
				csvProcessor.perOutputFunc = perOutputFunc;
				csvProcessor.perOutputFuncFlag = true;
			}else if(typeof perOutputFunc === 'string'){
				csvProcessor.perOutputFunc = undefined;
				console.log("出力ファイルごとに実行する処理は定義されませんでした",perOutputFunc);
				csvProcessor.perOutputFuncFlag = false;
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
			csvProcessor.addLogText("output",`ファイル読み込み中: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);
			
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
			csvProcessor.addLogText("output",`ファイル読み込み完了 加工処理開始: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);
			
			// 処理パート
			csvProcessor.inputFileTextObj = csvTextArray;
			const csvTextToArrayResult = csvProcessor.csvTextToArray(csvTextArray,{
				delimiter: options.inputDelimiter || ',',
				lineBreakSelect: options.inputLineBreakSelect=="CUSTOM"?options.inputLineBreakCustom:options.inputLineBreakSelect,
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
			csvProcessor.addLogText("output",`ファイル加工処理完了: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);
			
			const csvArray = csvTextToArrayResult.arrayObj;
			const rowTextArray = csvTextToArrayResult.rowTextObj;
			// csvProcessor.inputFileArray = csvArray;
			// csvProcessor.inputFileRowTextArray = rowTextArray;
			// 処理と書き込み
			const csvArrayAfterProcess = await csvProcessor.processCsv(csvIndex,csvTextToArrayResult);
			// console.log(csvArrayAfterProcess);
			csvProcessor.addLogText("output",`ファイルのすべての処理が完了: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);
			
			//csvProcessorをクリーンにする
			csvProcessor.inputFileTextObj = null;
			csvProcessor.inputFileText = "";
		}// inputFileごと
		await csvProcessor.closeAllOutputStream();
		console.log("processAll Finished");
		csvProcessor.addLogText("output","すべての処理が完了");
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
	
	processAllStream: async()=>{
		console.log("processAll Started");
		csvProcessor.addLogText("output","処理開始");
		
		const options = csvProcessor.getOptionsFromHtml();
		csvProcessor.options = options;
		csvProcessor.headerText = null;
		csvProcessor.sessionMemory = {};
		csvProcessor.inputRowCount = 0;
		csvProcessor.headerArray = undefined;
		
		if(!csvProcessor.outputDirectoryHandle){
			csvProcessor.dialog("出力ディレクトリが選択されていません。");
			csvProcessor.addLogText("output","出力ディレクトリが選択されていないため処理中断");
			return;
		}
		
		// lineBreakの設定
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
			case "CUSTOM":
				csvProcessor.options.outputLineBreak = options.outputLineBreakCustom || '\n';
				break
			default:
				csvProcessor.options.outputLineBreak = '\n';
				break;
		}
		
		
		// ユーザー関数の準備
		{
			// 入力ファイルごとに実行する処理
			
			let perInputFunc = csvProcessor.makeUserFunc(csvProcessor.editors.perInputCode.getValue());
			if(typeof perInputFunc === 'function'){
				csvProcessor.perInputFunc = perInputFunc;
				csvProcessor.perInputFuncFlag = true;
			}else if(typeof perInputFunc === 'string'){
				csvProcessor.perInputFunc = undefined;
				console.log("入力ファイルごとに実行する処理は定義されませんでした",perInputFunc);
				csvProcessor.perInputFuncFlag = false;
			}
			
			// 行ごとに実行する処理
			let perRowFunc = csvProcessor.makeUserFunc(csvProcessor.editors.perRowCode.getValue());
			if(typeof perRowFunc === 'function'){
				csvProcessor.perRowFunc = perRowFunc;
				csvProcessor.perRowFuncFlag = true;
			}else if(typeof perRowFunc === 'string'){
				csvProcessor.perRowFunc = undefined;
				console.log("行ごとに実行する処理は定義されませんでした",perRowFunc);
				csvProcessor.perRowFuncFlag = false;
			}
			
			// セルごとに実行する処理
			let perCellFunc = csvProcessor.makeUserFunc(csvProcessor.editors.perCellCode.getValue());
			if(typeof perCellFunc === 'function'){
				csvProcessor.perCellFunc = perCellFunc;
				csvProcessor.perCellFuncFlag = true;
			}else if(typeof perCellFunc === 'string'){
				csvProcessor.perCellFunc = undefined;
				console.log("セルごとに実行する処理は定義されませんでした",perCellFunc);
				csvProcessor.perCellFuncFlag = false;
			}
			
			// 出力ファイルごとに実行する処理
			let perOutputFunc = csvProcessor.makeUserFunc(csvProcessor.editors.perOutputCode.getValue());
			if(typeof perOutputFunc === 'function'){
				csvProcessor.perOutputFunc = perOutputFunc;
				csvProcessor.perOutputFuncFlag = true;
			}else if(typeof perOutputFunc === 'string'){
				csvProcessor.perOutputFunc = undefined;
				console.log("出力ファイルごとに実行する処理は定義されませんでした",perOutputFunc);
				csvProcessor.perOutputFuncFlag = false;
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
		if(!csvProcessor.inputFiles || csvProcessor.inputFiles.length == 0){
			csvProcessor.dialog("入力ファイルが選択されていません。");
			return;
		}
		//Inputファイルごとループ
		for(const [csvIndex,file] of csvProcessor.inputFiles.entries()){
			const csvArrayAfterProcess = await csvProcessor.processCsvStream(csvIndex);
			// 処理方法が「入力ファイルごとに書き込み」の場合、ここでファイル書き込み処理を行う
			if(options.outputWritingTiming == "input"){
				csvProcessor.writeToAllFile();
			}
			csvProcessor.addLogText("output",`ファイル処理完了: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${file.name}`);
			//csvProcessorをクリーンにする
			csvProcessor.inputFileTextObj = null;
			csvProcessor.inputFileText = "";
		}// inputFileごと
		await csvProcessor.closeAllOutputStream();
		console.log("processAll Finished");
		csvProcessor.addLogText("output","すべての処理が完了");
	},
	
	processCsvStream: async(csvIndex)=>{
		const csvFile = csvProcessor.inputFiles[csvIndex];
		console.log(`processCsv Started: ${csvIndex}`,csvFile);
		csvProcessor.addLogText("output",`ファイル読み込み開始: ${csvIndex+1}/${csvProcessor.inputFiles.length}:${csvFile.name}`);
		// readableStreamを作成
		const reader = csvFile.fileObj.stream().getReader();
		const options = csvProcessor.options;
		
		try {
			let readingBuffer = new Uint8Array(0); 
			// これは読み込み中のバッファ 
			// 読み込んだデータは一旦ここに格納し、文字コードを考慮して問題ない位置で切り出すのに使う
			let csvBuffer = [];
			// これはcsvのバッファ
			// CSVを行ごとに処理していき、余った部分を格納しておく
			// 1周終了時点では、ある行の途中部分までのデータが入っている
			
			let streamIndex = -1;
			let loadedSize = 0;
			let loadedRowNumber = 0;
			
			while (true) {
				console.log("chunk load start Index:",streamIndex);
				let done,value;
				if(!csvProcessor.options.inputLoadOnce){//通常のチャンク読み込み
					let tmp = await reader.read();
					done = tmp.done;
					value = tmp.value;
				}else{// 強制一括読み込み
					if(streamIndex == -1){
						value = new Uint8Array(await csvFile.fileObj.arrayBuffer());
						done = false;
					}else{
						done = true;
					}
				}
				streamIndex++;
				if (value) {
					loadedSize += value.length;
				}else{
					value = new Uint8Array(0);
				}
				let allLoaded = value.length==csvFile.fileObj.size //1回で全てのデータが読み込まれたかどうか
				let completed = loadedSize == csvFile.fileObj.size; //全体が読み込まれたかどうか
				let firstLoad = streamIndex == 0;
				
				console.log("chunk loaded Index:",streamIndex,"Size:",value.length,"done:",done,"value:",value,"allLoaded:",allLoaded,"completed:",completed,"firstLoad:",firstLoad);
				csvProcessor.addLogText("output",`チャンク読み込み :　${csvIndex+1}/${csvProcessor.inputFiles.length}:${csvFile.name} 第${streamIndex+1}チャンク Size:${value.length}(${loadedSize}/${csvFile.fileObj.size})`);
				
				// 1ファイル読み込み完了時の処理
				if (done) {
					break;
				}
				
				// ここでのvalueはUint8Array
				readingBuffer = new Uint8Array([...readingBuffer, ...value]);
				// 文字列配列として切り出せた部分と余り(文字列として成立しなかった部分)
				let [textArray,rest] = csvProcessor.uInt8ArrayToTextArray(readingBuffer,csvProcessor.options.inputEncoding,done);
				// 余りを次の読み込みに持ち越す
				readingBuffer = rest;
				csvBuffer = [...csvBuffer,...textArray];
				
				
				// ここからCSV処理
				// console.log(csvBuffer);
				
				let csvTextToArrayResult = csvProcessor.csvTextToArray(csvBuffer,{
					delimiter: options.inputDelimiter || ',',
					lineBreakSelect: options.inputLineBreakSelect=="CUSTOM"?options.inputLineBreakCustom:options.inputLineBreakSelect,
					skipRowNumber: options.inputSkipRowNumber || 0,
					skipEmptyRow: options.inputSkipEmptyRow || false,
					ignoreLastLineBreak: options.inputIgnoreLastLineBreak || false,
					isUsingHeader: options.inputIsUsingHeader || false,
					wrapper: options.inputWrapper || '"',
					isUsingWrapper: options.inputIsUsingWrapper || false,
					isUsingDelimiterInWrapper: options.inputIsUsingDelimiterInWrapper || false,
					isUsingWrapperInWrapper: options.inputIsUsingWrapperInWrapper || false,
					isUsingLineBreakInWrapper: options.inputIsUsingLineBreakInWrapper || false,
					last:completed,
					first:firstLoad,
				})
				
				
				// console.log(csvTextToArrayResult);
				
				csvBuffer = csvTextToArrayResult.restArray;
				
				let csvArray = csvTextToArrayResult.arrayObj;
				let rowTextArray = csvTextToArrayResult.rowTextObj;
				
				csvTextToArrayResult=undefined
				// continue;
				
				// csvごとに行う処理
				// ユーザー処理
				if(csvProcessor.perInputFuncFlag){
					try{
						let tmp = csvProcessor.perInputFunc({
							file: csvFile,
							fileObj: csvFile.fileObj,
							csvIndex,
							csvText: csvBuffer.join(''),
							csvArray,
							rowTextArray,
							options,
							allLoaded,
							completed,
							firstLoad,
							csvProcessor, //★メモリリークするなら入れない
							sessionRowCount : csvProcessor.inputRowCount,
						},csvProcessor.sessionMemory);
						if (Array.isArray(tmp)) {
							csvArray = tmp;
						}
					}
					catch(e){
						console.error(`入力ファイルごとに実行する処理の実行に失敗しました。`,e);
					}
				}
				
				
				
				// 処理と書き込み
				
				// firstがfalseのときは、最初の行(nullが入っている)を削除
				if(!firstLoad){
					csvArray.shift();
					rowTextArray.shift();
				}
				
				for(let [rowIndex,rowArray] of csvArray.entries()){
					if(rowArray === null)continue;
					// 行ごとに行う処理
					const rowText = rowTextArray[rowIndex];
					// ユーザー処理
					if(csvProcessor.perRowFuncFlag){
						try{
							let tmp = csvProcessor.perRowFunc({// a(argments)
								file: csvFile,
								fileObj: csvFile.fileObj,
								csvIndex,
								csvText: csvBuffer.join(''),
								csvArray,
								rowTextArray,
								options,
								allLoaded,
								completed,
								firstLoad,
								csvProcessor, //★メモリリークするなら入れない
								sessionRowCount : csvProcessor.inputRowCount,
								
								rowIndex: loadedRowNumber+rowIndex,
								rowArray,
								rowText,
							},csvProcessor.sessionMemory);
							if (Array.isArray(tmp)) {
								csvArray[rowIndex] = tmp;
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
								let tmp = csvProcessor.perCellFunc({ // a(argments)
									file: csvFile,
									fileObj: csvFile.fileObj,
									csvIndex,
									csvText: csvBuffer.join(''),
									csvArray,
									rowTextArray,
									options,
									allLoaded,
									completed,
									firstLoad,
									csvProcessor, //★メモリリークするなら入れない
									sessionRowCount : csvProcessor.inputRowCount,
									
									rowIndex: loadedRowNumber+rowIndex,
									rowArray,
									rowText,
									
									cellIndex,
									cellText,
								},csvProcessor.sessionMemory);
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
					if(rowIndex+loadedRowNumber == 0){
						// if(!csvProcessor.headerArray){
							// ヘッダー行は、記憶して終わり(書き出さない)
							csvProcessor.headerArray = JSON.parse(JSON.stringify(rowArray));
						// }
					}else{
						let outputFileNames = ["output.csv"];
						if(csvProcessor.outputFileNameFuncFlag){
							try{
								let tmp = csvProcessor.outputFileNameFunc({
									file: csvFile,
									fileObj: csvFile.fileObj,
									csvIndex,
									// csvText,
									csvArray,
									rowIndex: loadedRowNumber+rowIndex,
									rowArray,
									rowText,
									options,
									csvProcessor,
									sessionRowCount : csvProcessor.inputRowCount,
								},csvProcessor.sessionMemory);
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
							await csvProcessor.outputToFile(outputFileFullName,rowArray);
						}
						rowArray = undefined;
					}// if
					csvProcessor.inputRowCount++;
				} // 行ごと
				
				loadedRowNumber += csvArray.length;
				
				csvArray = undefined;
				rowTextArray = undefined;
				
			}
			
			
			
		} catch (error) {
			console.error('Error reading stream:', error);
		} finally {
			reader.releaseLock();
		}
		return;
		
		
		
		console.log(`processCsv Finished: ${csvIndex}`,csvFile);
		return csvArray;
	},
	
	getWriteableStream: async (outputFileFullName) => {
		let writeableStream;
		let tmpOutputText = ""; //今すぐ書き出すテキスト
		
		// 出力ファイルがなければ開く
		if(!csvProcessor.outputFiles[outputFileFullName]){
			csvProcessor.outputFiles[outputFileFullName] = {}
			csvProcessor.outputFiles[outputFileFullName].outputRowCount = 0;
		}
		
		if(!csvProcessor.outputFiles[outputFileFullName].writeableStream){
			// なければ作成
			console.log("File creating",outputFileFullName);
			csvProcessor.addLogText("output",`ファイル作成中: ${outputFileFullName}`);
			const fileHandle = await csvProcessor.outputDirectoryHandle.getFileHandle(outputFileFullName, {create: true});
			writeableStream = await fileHandle.createWritable();
			console.log("File created",outputFileFullName);
			csvProcessor.addLogText("output",`ファイル作成完了: ${outputFileFullName}`);
			csvProcessor.outputFiles[outputFileFullName].writeableStream = writeableStream;
			
			// prefixを書き込み
			if(csvProcessor.options.outputPrefixText!=""){
				tmpOutputText += csvProcessor.options.outputPrefixText
			}
			// ヘッダーを書き込み
			if(csvProcessor.headerArray && csvProcessor.options.outputIsUsingHeader){
				tmpOutputText += csvProcessor.headerArray.join(csvProcessor.options.outputDelimiter) + csvProcessor.options.outputLineBreak;
			}
			// 今すぐ書き出す
			const arraybuffer = csvProcessor.encodeText(tmpOutputText,csvProcessor.options.outputEncoding);
			await writeableStream.write(arraybuffer);
			
		}else{
			writeableStream = csvProcessor.outputFiles[outputFileFullName].writeableStream;
		}
		
		return writeableStream;
	},
	
	outputToFile: async (outputFileFullName,rowArray)=>{
		// バッファに書き込み
		await csvProcessor.writeToBuffer(outputFileFullName,rowArray);
		// writeableStreamを取得(ファイルがない場合は作成)
		const writeableStream = await csvProcessor.getWriteableStream(outputFileFullName);
		// 出力ファイルに書き込み
		if( 
			(csvProcessor.options.outputWritingTiming == "100" && csvProcessor.outputFiles[outputFileFullName].outputBuffer.length > 100) ||
			(csvProcessor.options.outputWritingTiming == "1000" && csvProcessor.outputFiles[outputFileFullName].outputBuffer.length > 1000) ||
			(csvProcessor.options.outputWritingTiming == "10000" && csvProcessor.outputFiles[outputFileFullName].outputBuffer.length > 10000)
		){
			await csvProcessor.writeToFile(outputFileFullName);
		}
	},
	
	writeToBuffer: async (outputFileFullName, rowArray)=>{
		if(!csvProcessor.outputFiles) csvProcessor.outputFiles = {};
		if(!csvProcessor.outputFiles[outputFileFullName]){
			csvProcessor.outputFiles[outputFileFullName] = {};
		}
		if(!csvProcessor.outputFiles[outputFileFullName].outputBuffer){
			csvProcessor.outputFiles[outputFileFullName].outputBuffer = [];
		}
		csvProcessor.outputFiles[outputFileFullName].outputBuffer.push(rowArray);
		csvProcessor.outputFiles[outputFileFullName].outputRowCount++;
	},
	
	writeToAllFile: async ()=>{
		for(const [outputFileFullName,outputFile] of Object.entries(csvProcessor.outputFiles)){
			await csvProcessor.writeToFile(outputFileFullName);
		}
	},
	
	writeToFile: async (outputFileFullName) => {
		
		const writeableStream = csvProcessor.outputFiles[outputFileFullName].writeableStream;
		const options = csvProcessor.options;
		let rowArrays = csvProcessor.outputFiles[outputFileFullName].outputBuffer;
		
		// 出力ファイルごとに実行するコードの実行
		if(csvProcessor.perOutputFuncFlag){
			try{
				let tmp = csvProcessor.perOutputFunc({
					rowArrays,
					options,
					// csvProcessor
				});
				if (Array.isArray(tmp)) {
					// csvArray[rowIndex] = tmp;
					rowArrays = tmp;
				}
			}
			catch(e){
				console.error(`出力ファイルごとに実行する処理の実行に失敗しました。`,e);
			}
		}
		
		// 出力テキストを作る
		let outputText = "";
		for(let i = 0; i < csvProcessor.outputFiles[outputFileFullName].outputBuffer.length; i++){
			const rowArray = rowArrays[i];
			outputText += csvProcessor.rowArrayToCsvText(rowArray,{
				delimiter: options.outputDelimiter || ',',
				// lineBreak: options.outputLineBreak || '\n',
				// isUsingHeader: options.outputIsUsingHeader || false,
				wrapper: options.outputWrapper || '"',
				isUsingWrapper: options.outputIsUsingWrapper || false,
				isUsingWrapperAll: options.outputIsUsingWrapperAll || false,
				isUsingSpecialCharacterInWrapper: options.outputIsUsingSpecialCharacterInWrapper || false,
				// addLastLineBreak: options.outputAddLastLineBreak || false,
			});
			if(i != csvProcessor.outputFiles[outputFileFullName].outputBuffer.length-1 || csvProcessor.options.outputAddLastLineBreak){
				outputText += csvProcessor.options.outputLineBreak;
			}
		}
		csvProcessor.outputFiles[outputFileFullName].outputBuffer = [];
		
		const arraybuffer = csvProcessor.encodeText(outputText,csvProcessor.options.outputEncoding);
		await writeableStream.write(arraybuffer);
		console.log("File wrote",outputFileFullName);
		csvProcessor.addLogText("output",`ファイル書き込みを実施: ${outputFileFullName}`);
	},
	
	closeAllOutputStream: async()=>{
		if(!csvProcessor.outputFiles || Object.keys(csvProcessor.outputFiles).length == 0){
			csvProcessor.dialog("出力ファイルが作成されませんでした。");
			return;
		}
		for(const [outputFileFullName,outputFile] of Object.entries(csvProcessor.outputFiles)){
			await csvProcessor.closeOutputStream(outputFileFullName);
		}
	},
	
	closeOutputStream: async (outputFileFullName) => {
		if(!csvProcessor.outputFiles[outputFileFullName].writeableStream){
			return;
		}
		const writeableStream = csvProcessor.outputFiles[outputFileFullName].writeableStream;
		
		// バッファに残っているものを書き込む
		await csvProcessor.writeToFile(outputFileFullName);
		let outputText = "";
		
		// 改行を追加
		// if(csvProcessor.options.outputAddLastLineBreak){
		// 	outputText += csvProcessor.options.outputLineBreak;
		// }
		
		// suffixTextを書き込み
		if(csvProcessor.options.outputSuffixText!=""){
			outputText += csvProcessor.options.outputSuffixText
		}
		
		// ストリーム書き込み
		const arraybuffer = csvProcessor.encodeText(outputText,csvProcessor.options.outputEncoding);
		await writeableStream.write(arraybuffer);
		writeableStream.close();
		console.log("File closed",outputFileFullName);
		csvProcessor.addLogText("output",`ファイルをクローズ: ${outputFileFullName}`);
		
		// ストリーム削除
		delete csvProcessor.outputFiles[outputFileFullName].writeableStream;
		delete csvProcessor.outputFiles[outputFileFullName];
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
	
	makeUserFunc: (userCode)=>{
		if(!userCode || userCode == ""){
			return "userFunc is empty";
		}
		let code= `try{\n${userCode}\n}catch(e){console.log("userFunc failed:",e.message);console.error(e);}`;
		let returnFunc;
		try{
			returnFunc = new Function("a,m,f",code);
		}catch(e){
			console.log("makeUserFunc Failed:",e);
			return e.message;
		}
		return returnFunc;
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
				case 'radio':
				if(element.checked){
					options[key] = element.value;
				}
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
	
	setOptionsToHtml: (options)=>{
		// HTMLに各オプションの値をセット
		// HTMLの[data-option]属性を持つ要素を取得
		const optionElements = document.querySelectorAll('[data-option]');
		optionElements.forEach(function(element){
			const key = element.dataset.option;
			const value = options[key];
			
			// type属性によって適切に処理する
			switch(element.type){
				case 'checkbox':
				element.checked = value;
				break;
				case 'radio':
				if(element.value == value){
					element.checked = true;
				}else{
					element.checked = false;
				}
				break;
				case 'number':
				element.value = value;
				break;
				default:
				element.value = value;
				break;
			}
			
			// イベント発火
			const event = new Event('change');
			element.dispatchEvent(event);
		});
	},
	
	csvTextToArray: (csvTextInput,options={
		delimiter:',',
		lineBreakSelect:'ALL', // ALL,LF,CR,CRLF,文字列
		skipRowNumber:0,
		skipEmptyRow:false, 
		ignoreLastLineBreak:false,
		isUsingHeader:false,
		wrapper:'"',
		isUsingWrapper:false,
		isUsingDelimiterInWrapper:false,
		isUsingWrapperInWrapper:false,
		isUsingLineBreakInWrapper:false,
		first:true, //最初の呼び出しかどうか 先頭行の読み飛ばしなどを行う
		last:true, //最後の呼び出しかどうか 最後の行の改行を無視するなどを行う
	})=>{
		
		
		// csvTextInputは文字列か、1文字ずつの配列(中身は文字)
		
		// ここからしばらく、入力は配列として扱う
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
			case 'CUSTOM':
				lineBreakRegExp = new RegExp(options.lineBreakSelect);
				lineBreak = options.lineBreakSelect;
				break;
			default:
				lineBreakRegExp = /\n/;
				lineBreak = '\n';
				break;
		}
		
		// 改行をLFに統一
		let tmpArray = [];
		if(options.lineBreakSelect == "ALL"){
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
		}else if(options.lineBreakSelect == "CR"){
			for( let i = 0; i < csvTextArray.length; i++){
				if(csvTextArray[i] == '\r'){
					// CRはLFに変換
					tmpArray.push('\n');
				}else{
					tmpArray.push(csvTextArray[i]);
				}
			}
			csvTextArray = tmpArray;
		}else if(options.lineBreakSelect == "CRLF"){
			for( let i = 0; i < csvTextArray.length; i++){
				if(csvTextArray[i] == '\r' && csvTextArray[i+1] == '\n'){
					// CRLFはLFに変換
					tmpArray.push('\n');
					i++;
				}else{
					tmpArray.push(csvTextArray[i]);
				}
			}
			csvTextArray = tmpArray;
		}
		
		
		//入力末尾の改行を消す
		if(options.ignoreLastLineBreak && options.last){
			if(csvTextArray[csvTextArray.length-1] == '\n'){
				csvTextArray.pop();
			}
		}
		
		// 先頭行を読み飛ばして捨てる
		if(options.skipRowNumber > 0 && options.first){
			let rowCount = 0;
			let tmp="";
			const length = csvTextArray.length;
			for( let i = 0; i < length; i++){
				// 先頭から1文字取り出す
				tmp = csvTextArray.shift();
				if(tmp == '\n'){
					rowCount++;
					if(rowCount == options.skipRowNumber){
						break;
					}
				}
			}
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
		
		// return {arrayObj:[],rowTextObj:[],restArray:[]};
		
		let arrayObj=[];
		let rowTextObj=[];
		let restArray = [];
		switch(readingMode){
			case 1:
			{
				// 行に分割
				let rows = csvProcessor.splitTextArray(csvTextArray, "\n", "String");
				
				// ヘッダー行が無い場合 or 2回目以降の呼び出しの場合はnullを格納
				if(!options.isUsingHeader || !options.first){
					arrayObj[0] = null;
					rowTextObj[0] = null;
				}
				
				// それ以外の行を格納
				for(let i = 0; i < rows.length; i++){
					//最終行かつoptions.lastがfalseの場合、処理しない
					if(i == rows.length-1 && !options.last){
						restArray = rows[i].split("");
						break;
					}
					rowTextObj.push(rows[i]);
					const rowData = rows[i].split(options.delimiter);
					if(options.skipEmptyRow && rowData.length == 1 && rowData[0] == ""){
						//行が空の場合はスキップ
						continue;
					}
					let row = [];
					for(let j = 0; j < rowData.length; j++){
						// const cellData = rowData[j];
						let cell = rowData[j];
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
						cell = undefined;
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
							// case lineBreakMatch:
							case "\n":
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
							// case lineBreakMatch:
							case "\n":
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
						// if(char != lineBreakMatch){
						if(char != "\n"){
							afterLineBreak = false
						};
						afterWrapperCharacter = false;
					}//if(inWrapper)
				}//1文字ずつ
				
				// 最後のセルを追加
				row.push(cell);
				// arrayObj.push(row);
				// rowTextObj.push(rowText);

				if(options.last){
					arrayObj.push(row);
				}else{
					restArray = (row.join('')).split("")
				}
			}
			break;
		}//switch
		// console.log(arrayObj);
		return {arrayObj,rowTextObj,restArray};
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
		// lineBreak:'\n',
		// isUsingHeader:false,
		wrapper:'"',
		isUsingWrapper:false,
		isUsingWrapperAll:false,
		isUsingSpecialCharacterInWrapper:false,
		// addLastLineBreak:false
	})=>{
		
		let returnRowArray = [];

		// 先に、すべてのセルの特殊文字をチェック・置換
		if(options.isUsingWrapper && (options.isUsingSpecialCharacterInWrapper||options.isUsingWrapperAll) ){
			for(const [cellIndex,cell] of rowArray.entries()){
				if(options.isUsingWrapperAll || (cell.includes(options.wrapper)||cell.includes(options.delimiter)||cell.includes("\n")||cell.includes("\r"))){ // 安全のため、CR・LFのいずれかがある場合はエスケープ
					rowArray[cellIndex] = `${options.wrapper}${cell.replace(new RegExp(options.wrapper, 'g'), options.wrapper + options.wrapper)}${options.wrapper}`;
				}
			}
		}
		
		return rowArray.join(options.delimiter);
	},
	
	// プロファイル操作
	exportProfile: ()=>{
		// プロファイルをエクスポート
		let profile = {
			title:"CSV Processor Profile",
			version: csvProcessor.version,
			options: csvProcessor.getOptionsFromHtml(),
			perInputCode: csvProcessor.editors.perInputCode.getValue(),
			perRowCode: csvProcessor.editors.perRowCode.getValue(),
			perCellCode: csvProcessor.editors.perCellCode.getValue(),
			perOutputCode: csvProcessor.editors.perOutputCode.getValue(),
		};
		let profileText = JSON.stringify(profile);
		let blob = new Blob([profileText], {type: 'application/json'});
		let url = URL.createObjectURL(blob);
		let a = document.createElement('a');
		const profileName = prompt("プロファイルの名前を入力してください:", "profile.json");
		if (profileName) {
			a.download = profileName;
			a.href = url;
			a.click();
		}
	},
	
	importProfile: async ()=>{
		// プロファイルをインポート
		let input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.onchange = async function(event) {
			let file = event.target.files[0];
			let reader = new FileReader();
			reader.onload = async function(event) {
				let profileText = event.target.result;
				let profile = JSON.parse(profileText);
				csvProcessor.setOptionsToHtml(profile.options);
				//一旦codePaneのすべてのタブを表示
				const codePaneTabs = document.querySelectorAll('#codePaneTabBox>.tab');
				codePaneTabs.forEach(function(tab) {
					tab.style.display = 'block';
				});
				csvProcessor.editors.perInputCode.setValue(profile.perInputCode);
				csvProcessor.editors.perRowCode.setValue(profile.perRowCode);
				csvProcessor.editors.perCellCode.setValue(profile.perCellCode);
				csvProcessor.editors.perOutputCode.setValue(profile.perOutputCode);				
				//codePaneをもとに戻す
				codePaneTabs.forEach(function(tab) {
					tab.style.removeProperty('display');
				}
			};
			reader.readAsText(file);
		};
		input.click();
	},
	
	saveProfile: ()=>{
		// localStorageにプロファイルを保存
		let profile = {
			title:"CSV Processor Profile",
			version: csvProcessor.version,
			options: csvProcessor.getOptionsFromHtml(),
			perInputCode: csvProcessor.editors.perInputCode.getValue(),
			perRowCode: csvProcessor.editors.perRowCode.getValue(),
			perCellCode: csvProcessor.editors.perCellCode.getValue(),
			perOutputCode: csvProcessor.editors.perOutputCode.getValue(),
		};
		// localStorage対応チェック
		if (typeof localStorage === 'undefined') {
			alert('このブラウザはlocalStorageに対応していません。');
			return;
		}
		let currentProfiles = JSON.parse(localStorage.getItem('csvProcessorProfiles'));
		if(!currentProfiles)currentProfiles = {};
		
		// 名前を入力
		const profileName = prompt("プロファイルの名前を入力してください:", "profile");
		if (profileName) {
			currentProfiles[profileName] = profile;
			localStorage.setItem('csvProcessorProfiles', JSON.stringify(currentProfiles));
		}
		
		csvProcessor.listLocalProfiles();
	},
	
	listLocalProfiles: ()=>{
		// localStorageに保存されたプロファイルをリスト表示
		let currentProfiles = JSON.parse(localStorage.getItem('csvProcessorProfiles'));
		if(!currentProfiles)currentProfiles = {};
		let profileList = document.getElementById('profileSelect');
		profileList.innerHTML = '';
		for(const [profileName,profile] of Object.entries(currentProfiles)){
			let option = document.createElement('option');
			option.value = profileName;
			option.textContent = profileName;
			profileList.appendChild(option);
		}
	},
	
	loadProfile: ()=>{
		// 読込確認
		if(!confirm("現在の設定を上書きします。よろしいですか？"))return;
		
		// localStorageからプロファイルを読み込み
		let profileList = document.getElementById('profileSelect');
		let profileName = profileList.value;
		let currentProfiles = JSON.parse(localStorage.getItem('csvProcessorProfiles'));
		if(!currentProfiles)currentProfiles = {};
		let profile = currentProfiles[profileName];
		if(profile){
			csvProcessor.setOptionsToHtml(profile.options);
			// 一旦codePaneのすべてのタブを表示
			const codePaneTabs = document.querySelectorAll('#codePaneTabBox>.tab');
			codePaneTabs.forEach(function(tab) {
				tab.style.display = 'block';
			});
			csvProcessor.editors.perInputCode.setValue(profile.perInputCode);
			csvProcessor.editors.perRowCode.setValue(profile.perRowCode);
			csvProcessor.editors.perCellCode.setValue(profile.perCellCode);
			csvProcessor.editors.perOutputCode.setValue(profile.perOutputCode);		
			// codePaneをもとに戻す
			codePaneTabs.forEach(function(tab) {
				tab.style.removeProperty('display');
			});
		}
	},
	
	removeProfile: ()=>{
		// 削除確認
		if(!confirm("本当に削除しますか？"))return;
		
		// localStorageからプロファイルを削除
		let profileList = document.getElementById('profileSelect');
		let profileName = profileList.value;
		let currentProfiles = JSON.parse(localStorage.getItem('csvProcessorProfiles'));
		if(!currentProfiles)currentProfiles = {};
		delete currentProfiles[profileName];
		localStorage.setItem('csvProcessorProfiles', JSON.stringify(currentProfiles));
		csvProcessor.listLocalProfiles();
	},
	
	
	//汎用品
	dialog: (message)=>{
		alert(message);
	},
	
	changeStatusText: (type,message)=>{
		document.getElementById(`${type}StatusText`).textContent = message;
	},
	
	addLogText: (type,message,limit=20)=>{
		let element = document.getElementById(`${type}StatusText`)
		element.appendChild(document.createElement('p')).textContent = message;
		if(limit && element.childElementCount > limit){
			element.removeChild(element.firstChild);
		}
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
	
	uInt8ArrayToTextArray: (uInt8Array,encode,done)=>{
		// マルチバイト文字に対応しつつ、1文字ずつの配列に変換
		// 文字コードのデコードもする
		
		// doneがtrueの場合は、あまりを返さない(強制的に変換する)
		// バイト列が不正だった場合はエラーになると思われる
		// 将来的にはdone不要になってほしい
		
		let resultArray = [];
		// const limit = 1;
		const limit = 50_000_000;
		let lastSplitPosition = 0;
		let textArray = []; // 分割前テキスト配列(中身はUInt8)
		for(let i = 0; i < uInt8Array.length; i++){
			textArray.push(uInt8Array[i]);
			if(textArray.length >= limit || i > uInt8Array.length-20){
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
				if(breakSafeFlag || (i == uInt8Array.length-1 && done)){
					// console.log("break 1",i);
					let uInt8Array = new Uint8Array(textArray);
					// console.log("break 2",i);
					let text = new TextDecoder(encode).decode(uInt8Array);
					// console.log("break 3",i);
					let textArrayEncoded = text.split('');
					// console.log("break 4",i);
					resultArray = [...resultArray,...textArrayEncoded];
					// console.log("break 5",i);
					textArray = [];
					lastSplitPosition = i;
					// console.log("break 6",i);
				}
			}
		}
		let rest = uInt8Array.slice(lastSplitPosition+1);
		// if(rest.length == 0)rest = null;
		
		return [resultArray,rest];
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