#!/bin/zsh
# usage: exp.sh <tag>  — full run + score
cd /Users/user01/Desktop/GEO_master
ego-browser nodejs -e "globalThis.RUN_TAG=\"$1\"; await import(\"file:///Users/user01/Desktop/GEO_master/autoresearch/frontend-design/tools/run.mjs\")" > .gstack/frontend-design/$1.log 2>&1
node autoresearch/frontend-design/eval/score.mjs autoresearch/frontend-design/results/$1-pages.json > autoresearch/frontend-design/results/$1-score.json
node -e 'const b=require("./autoresearch/frontend-design/results/baseline-score.json"),p=require(process.argv[2]),c=require(process.argv[1]);console.log(JSON.stringify({score:c.score,prev:p.score,delta:+(c.score-p.score).toFixed(4),axes:c.axes,guard:c.guard,issues:c.integrityIssues}))' ./autoresearch/frontend-design/results/$1-score.json ./autoresearch/frontend-design/results/${2:-baseline}-score.json
