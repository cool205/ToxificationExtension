// Mutation Observer for social feeds that add new content
//Intersection Observer for lazy-loading
// TreeWalker for initial scan

const textNodeList = [];

function scanText(root = document.body) {
    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        },
        false
    );

    let node;
    while((node = walker.nextNode())) {
        if (!textNodeList.some(item => item.node === node)){
            textNodeList.push({
                node: node,
                originalText: node.nodeValue,
            });
        }
    }
}

scanText(document.body); // Initial scan



const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                scanText(node);
            }
        });
    });
});

mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
});

const intersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            scanText(entry.target);
        }
    });
});

document.querySelectorAll('*').forEach((el) => {
    intersectionObserver.observe(el);
});