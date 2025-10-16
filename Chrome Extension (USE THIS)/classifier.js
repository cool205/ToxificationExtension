function tokenize(text){
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // remove punctuation
        .split(/\s+/) // split by whitespace
        .filter(token => token.length > 0); // remove empty tokens
}

export function classify(text){
    tokenizeText = tokenize(text);
    return "toxic"; //sample placeholder
}