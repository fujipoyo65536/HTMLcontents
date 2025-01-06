# 牌姿から点数を算出

## 引数:牌姿
### 牌情報
```
{
	members:[ //面子
		{
			type:"solo",//鳴いてない牌はここ
			tiles:[
				"1m","2m","3m",・・・
			]
		},
		{
			type:"pon", //鳴いた牌など。"pon","chi","h_kan"(暗槓),"l_kan"(大明槓),"k_kan"(加槓)
			tiles:[
				"px","px","px"
			]
		},
		{
			type:"agari",
			tile:"1m",
		}
	],
	state:{
		type:"tsumo", //または"ron","chankan"	,"rinshan"
		first:false, //またはtrue 初順の場合 天和・地和・人和判定用
		parent:false, //またはtrue 親か子か 天和・地和判定用
		last:false, //またはtrue 海底・河底判定用
		reach:null //trueではないので注意 または"reach","double"
		ippatsu:true,//またはfalse,null(立直なしの場合)
		tsubame:false,//またはtrue 燕返し
		kanburi:false,//またはtrue 槓振り
		nagashi:true,//流し満貫
		dora:[
			["1p"], //表ドラ
			["1s"], //裏ドラ
			0 //抜きドラの数
		],
		kaze:[
			0,0 //場風・自風 0-3:東南西東
		]
	}
}
```


### 牌種別
* 1m-9m:萬子
* 1p-9p:筒子
* 1s-9s:索子
* tx,nx,sx,px:東南西北
* 赤牌は数字の前に"r"
* hx,rx,cx:白発中

## 返り値
* 翻
* 符

