// todo
// 空行を無視する
// 列数が合わない行

// DOM読み込み後のイベント設定
document.addEventListener('DOMContentLoaded', function() {

  // #csvDataInputが変更されたらプレビューを更新
  document.getElementById('csvDataInput').addEventListener('input', function(){
    updatePreview();
  });

  document.getElementById('delimiterInput').addEventListener('input', function(){
    updatePreview();
  });
  document.getElementById('lineBreakInput').addEventListener('input', function(){
    updatePreview();
  });
  document.getElementById('skipRowNumberInput').addEventListener('input', function(){
    updatePreview();
  });

  document.getElementById('isHeaderCheckbox').addEventListener('change', function(){
    updatePreview();
  });


  //デバッグ用
  document.getElementById('csvDataInput').value = '1,2,3\n4,5,6\n7,"8",9\ntest1,"te\nst2"\nabc,def,ghi,jkl,mno\n\npqr,stu,vwx,yz';
  updatePreview();
});

function updatePreview(){
  const inputText = document.getElementById('csvDataInput').value;
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
      lineBreak = /\r\n|\r|\n/;
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
  const isHeader = document.getElementById('isHeaderCheckbox').checked || false;
  const wrapper = document.getElementById('wrapperInput').value || '"';

  const rows = csvText.split(lineBreak);
  
  // 先頭行を読み飛ばして捨てる
  for(let i = 0; i < skipRowNumber; i++){
    rows.shift();
  }

  // 以下、データの複雑さによって分岐する(工事中)

// レベル2メソッド
  // {
  //   let result = [];
  //   // ヘッダー行があるならresult[0]に格納
  //   if(isHeader){
  //     result[0] =rows.shift().split(delimiter);
  //   }else{
  //     result[0] = null;
  //   }
  //   // それ以外の行を格納
  //   for(let i = 0; i < rows.length; i++){
  //     const rowData = rows[i].split(delimiter);
  //     let row = [];
  //     for(let j = 0; j < rowData.length; j++){
  //       const cellData = rowData[j];
  //       let cell = cellData;
  //       // 両側の空白を削除
  //       cell = cell.trim();
  //       // 両側の囲み文字を削除(囲み文字に両側を囲まれている場合のみ)
  //       cell = cell.replace(new RegExp(`^${wrapper}(.*)${wrapper}$`), '$1');
  //       // 囲み文字の中の囲み文字をエスケープ
  //       cell = cell.replace(new RegExp(wrapper + wrapper, 'g'), wrapper);
  //       // 結果に追加
  //       row.push(cell);
  //     }
  //     result.push(row);
  //   }
  //   console.log(result);
  // }

　//レベル3メソッド
  {
    // 時間計測のテスト

    // const start = performance.now();
    // const testText = csvText
    // const regExp = new RegExp(`(?=[${delimiter}${lineBreak}${wrapper}\r\n])|(?<=[${delimiter}${lineBreak}${wrapper}\r\n])`);
    // let outputText = ""
    // for(let i = 0; i < 10000; i++){
    //   outputText = testText.split(regExp);
    // }
    // const end = performance.now();
    // console.log(outputText);
    // console.log(`レベル3メソッド: ${end - start}ms`);

    // const start2 = performance.now();
    // const testText2 = csvText
    // let outputText2 = ""
    // for(let i = 0; i < 10000; i++){
    //   outputText2 = testText2.split("");
    // }
    // const end2 = performance.now();
    // console.log(outputText2);
    // console.log(`単純なsplit: ${end2 - start2}ms`);

    let splitText;
    if(skipRowNumber > 0){
      splitText = rows.join("\n")
    }else{
      splitText = csvText.split("");
    }
    let result=[];
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
            if(!afterLineBreak){ // 連続する改行は無視
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
    if(cell != ""){
      row.push(cell);
    }
    if(row.length > 0){
      result.push(row);
    }

    console.log(result);
    return result;
  }
  // return result;

 
}