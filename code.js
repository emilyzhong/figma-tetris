// Visible starts out as false and becomes true after checking if file is valid.
figma.showUI(__html__, { visible: false, height: 453, width: 400 });
figma.ui.onmessage = msg => {
    switch (msg.type) {
        case 'start':
            if (!gameFunction) {
                gameFunction = setInterval(play, CLOCK_TICK);
            }
            break;
        case 'reset':
            resetGame();
            break;
        case 'move-left':
            moveCurrentTetrimoX(-1);
            break;
        case 'move-right':
            moveCurrentTetrimoX(1);
            break;
        case 'soft-drop':
            moveCurrentTetrimoY(1);
            break;
        case 'hard-drop':
            hardDrop();
            break;
        case 'rotate':
            rotate();
            break;
        case 'hold':
            hold();
            break;
        case 'enable-multiplayer':
            enableMultiplayer();
            break;
        case 'disable-multiplayer':
            disableMultiplayer();
            break;
        case 'player-1-select':
            updatePlayerNum(1);
            break;
        case 'player-2-select':
            updatePlayerNum(2);
            break;
        case 'dead-row': // Simulate adding a dead row to the queue. Only for development purposes
            setNumPendingDeadRows(numPendingDeadRows() + 1);
            break;
    }
};
const invalidFile = () => {
    figma.notify('Invalid / out of date file: Please duplicate the Figma tetris file and try again.');
    figma.closePlugin();
};
const playPage = figma.root.findChild(node => node.name === 'Play');
if (playPage) {
    figma.currentPage = playPage;
    figma.ui.show();
    figma.root.setRelaunchData({ play: '' });
}
else {
    invalidFile();
}
const UNIT = 60;
const CLOCK_TICK = 800;
// Array of tetrimo components to choose from
const TETRIMO_COMPONENTS = figma.root.findAll(node => {
    return node.type === 'COMPONENT' && node.name.length === 1;
});
const DEAD_ROW = figma.root.findOne(node => node.type === 'COMPONENT' && node.name === 'Dead Row');
const PENDING_DEAD_ROW = figma.root.findOne(node => node.type === 'COMPONENT' && node.name === 'Pending Dead Row');
// Figma sets the (x, y) attributes of a shape to the upper left corner.
// Y increases as it goes downwards, X increases to the right.
// These coordiantes are the "solid" areas of each tetrimo type,
// relative to the upper-left (x, y)
const TUP = (x, y) => { return { x, y }; }; // Helper function
const asUnits = (n) => Math.round(n / UNIT);
let gameFunction;
let visibleTetrimoGroup;
let rotationNum = 0;
let needNewTetrimo = true;
let score = 0;
let playerNum = 1;
let combo = 0;
let multiplayer = false;
let hasHeld = false; // Used to only allow users to swap held once per turn
let BOARD_PARENT_FRAME = figma.currentPage.findOne(node => node.name === `Player ${playerNum}`);
!BOARD_PARENT_FRAME && invalidFile();
let BOARD_AND_DEAD_ROWS = BOARD_PARENT_FRAME.findOne(node => node.name === 'Board + Dead Lines');
!BOARD_PARENT_FRAME && invalidFile();
let BOARD = BOARD_AND_DEAD_ROWS.findOne(node => node.name === "Board" && node.type === 'FRAME');
let NEXT_PIECE = BOARD_PARENT_FRAME.findOne(node => node.name === "Next Piece");
let HOLD = BOARD_PARENT_FRAME.findOne(node => node.name === "Hold");
let DEAD_ROW_QUEUE = BOARD_PARENT_FRAME.findOne(node => node.name === 'Pending Dead Row Queue');
let OPPONENT_BOARD_PARENT_FRAME = figma.currentPage.findOne(node => node.name === `Player ${playerNum == 1 ? 2 : 1}`);
let OPPONENT_DEAD_ROW_QUEUE = OPPONENT_BOARD_PARENT_FRAME.findOne(node => node.name === 'Pending Dead Row Queue');
function clone(val) {
    const type = typeof val;
    if (val === null) {
        return null;
    }
    else if (type === 'undefined' || type === 'number' ||
        type === 'string' || type === 'boolean') {
        return val;
    }
    else if (type === 'object') {
        if (val instanceof Array) {
            return val.map(x => clone(x));
        }
        else if (val instanceof Uint8Array) {
            return new Uint8Array(val);
        }
        else {
            let o = {};
            for (const key in val) {
                o[key] = clone(val[key]);
            }
            return o;
        }
    }
    throw 'unknown';
}
const enableMultiplayer = () => {
    multiplayer = true;
    figma.currentPage.findOne(node => node.name === `Player 2`).visible = true;
};
const disableMultiplayer = () => {
    multiplayer = false;
    updatePlayerNum(1);
    figma.currentPage.findOne(node => node.name === `Player 2`).visible = false;
};
const updatePlayerNum = (num) => {
    if (playerNum === num)
        return;
    playerNum = num;
    BOARD_PARENT_FRAME = figma.currentPage.findOne(node => node.name === `Player ${num}`);
    BOARD_PARENT_FRAME.visible = true;
    BOARD = BOARD_PARENT_FRAME.findOne(node => node.name === "Board" && node.type === 'FRAME');
    NEXT_PIECE = BOARD_PARENT_FRAME.findOne(node => node.name === "Next Piece");
    HOLD = BOARD_PARENT_FRAME.findOne(node => node.name === "Hold");
    DEAD_ROW_QUEUE = BOARD_PARENT_FRAME.findOne(node => node.name === 'Pending Dead Row Queue');
    BOARD_AND_DEAD_ROWS = BOARD_PARENT_FRAME.findOne(node => node.name === 'Board + Dead Lines');
    OPPONENT_BOARD_PARENT_FRAME = figma.currentPage.findOne(node => node.name === `Player ${playerNum == 1 ? 2 : 1}`);
    OPPONENT_DEAD_ROW_QUEUE = OPPONENT_BOARD_PARENT_FRAME.findOne(node => node.name === 'Pending Dead Row Queue');
};
// This stores which coordinates of the board are filled.
// It is first indexed on y, then x, then a rectangle node that will sit at that location.
let _filledCoords = {};
const addToFilledCoords = (unitNode) => {
    const { x, y } = unitBoardCoordinates(unitNode);
    if (!_filledCoords[y]) {
        _filledCoords[y] = {};
    }
    const newRectangle = figma.createRectangle();
    newRectangle.resize(60, 60);
    newRectangle.fills = clone(unitNode.fills);
    newRectangle.x = x * UNIT;
    newRectangle.y = y * UNIT;
    newRectangle.constraints = { horizontal: 'MIN', vertical: 'MAX' };
    BOARD.appendChild(newRectangle);
    const filledCoordsY = y + numDeadRows();
    if (!_filledCoords[filledCoordsY]) {
        _filledCoords[filledCoordsY] = {};
    }
    _filledCoords[y + numDeadRows()][x] = newRectangle;
};
const coordIsFilled = (coord) => {
    const { x, y } = coord;
    return !!(_filledCoords[y + numDeadRows()] && _filledCoords[y + numDeadRows()][x]);
};
const tetrimoGroup = () => {
    return visibleTetrimoGroup.parent;
};
// Given one unit node, return its coordinates on the tetris board
const unitBoardCoordinates = (unitNode) => {
    const tetrimoParent = tetrimoGroup();
    const x = unitNode.x + tetrimoParent.x;
    const y = unitNode.y + tetrimoParent.y;
    return TUP(asUnits(x), asUnits(y));
};
const addDeadRowsFromQueue = () => {
    const numRows = numPendingDeadRows();
    setNumPendingDeadRows(0);
    for (let i = 0; i < numRows; i++) {
        BOARD_AND_DEAD_ROWS.appendChild(DEAD_ROW.createInstance());
    }
};
const removeDeadRows = (n) => {
    const deadRows = BOARD_AND_DEAD_ROWS.findAll(child => child !== BOARD);
    deadRows.slice(0, n).forEach(row => row.remove());
};
const numDeadRows = () => BOARD_AND_DEAD_ROWS.children.length - 1;
const numPendingDeadRows = () => DEAD_ROW_QUEUE.children.length;
const setNumPendingDeadRows = (n) => {
    const currPending = numPendingDeadRows();
    if (n > currPending) {
        for (let i = 0; i < n - currPending; i++) {
            DEAD_ROW_QUEUE.appendChild(PENDING_DEAD_ROW.createInstance());
        }
    }
    else {
        DEAD_ROW_QUEUE.children.slice(0, currPending - n).forEach(node => node.remove());
    }
};
const sendPendingDeadRowsToOpponent = (n) => {
    for (let i = 0; i < n; i++) {
        OPPONENT_DEAD_ROW_QUEUE.appendChild(PENDING_DEAD_ROW.createInstance());
    }
};
const resetGame = () => {
    var _a, _b;
    clearInterval(gameFunction);
    gameFunction = null;
    BOARD_AND_DEAD_ROWS.children.forEach(child => child !== BOARD && child.remove());
    setNumPendingDeadRows(0);
    BOARD.children.forEach(child => child.remove());
    (_a = NEXT_PIECE === null || NEXT_PIECE === void 0 ? void 0 : NEXT_PIECE.children) === null || _a === void 0 ? void 0 : _a.forEach(child => child.remove());
    (_b = HOLD === null || HOLD === void 0 ? void 0 : HOLD.children) === null || _b === void 0 ? void 0 : _b.forEach(child => child.remove());
    score = 0;
    needNewTetrimo = true;
    rotationNum = 0;
    visibleTetrimoGroup = null;
    _filledCoords = {};
    figma.ui.postMessage(0);
};
const generateCurrentTetrimo = () => {
    // Remove previous tetrimo
    if (visibleTetrimoGroup) {
        visibleTetrimoGroup.parent.remove();
    }
    const index = Math.floor(Math.random() * TETRIMO_COMPONENTS.length);
    const tetrimo = TETRIMO_COMPONENTS[index];
    let tetrimoGroup = tetrimo.createInstance();
    rotationNum = 1;
    tetrimoGroup.children.forEach(child => {
        if (child.name == rotationNum.toString()) {
            child.visible = true;
        }
        else {
            child.visible = false;
        }
    });
    // If we are supporting seeing the next piece, set the existing next piece as the new current piece,
    // and set the newly generated piece as the new next piece
    if (NEXT_PIECE) {
        const nextTetrimoGroup = tetrimoGroup;
        nextTetrimoGroup.resize(nextTetrimoGroup.width * .6, nextTetrimoGroup.height * .6);
        tetrimoGroup = NEXT_PIECE.findChild(() => true); // There should only be one thing piece
        NEXT_PIECE.appendChild(nextTetrimoGroup);
        nextTetrimoGroup.y = UNIT / 2;
        if (!tetrimoGroup) {
            // The first time this gets run, tetrimoGroup will be null because there is nothing in next piece
            // Thus, we will call use this first call as filling "next piece", then short-circuit and call
            // generateCurrentTetrimo to fill both the current piece and the next piece.
            generateCurrentTetrimo();
            return;
        }
        tetrimoGroup === null || tetrimoGroup === void 0 ? void 0 : tetrimoGroup.resize(tetrimoGroup.width * 1.67, tetrimoGroup.height * 1.67);
    }
    tetrimoGroup.x = BOARD.width / 2;
    tetrimoGroup.y = 0;
    BOARD.appendChild(tetrimoGroup);
    visibleTetrimoGroup = tetrimoGroup.findChild(child => child.visible);
    needNewTetrimo = false;
};
const moveCurrentTetrimoX = (x) => {
    if (!visibleTetrimoGroup) {
        return;
    }
    // Check if can move left/right first
    const unitChildren = visibleTetrimoGroup.children;
    for (let i = 0; i < unitChildren.length; i++) {
        const child = unitChildren[i];
        const { x: currX, y } = unitBoardCoordinates(child);
        // If this will push us out of bounds
        if ((currX + x) < 0 || (currX + x) >= 10) {
            return;
        }
        // If this will push us into a filled spot
        if (coordIsFilled({ x: currX + x, y })) {
            return;
        }
    }
    // If ok, then move
    tetrimoGroup().x += (UNIT * x);
};
const moveCurrentTetrimoY = (y) => {
    if (!visibleTetrimoGroup) {
        return;
    }
    if (canMoveDown()) {
        tetrimoGroup().y += (UNIT * y);
    }
};
// Very hacky lol
const hardDrop = () => {
    while (canMoveDown()) {
        moveCurrentTetrimoY(1);
    }
};
const rotate = () => {
    rotationNum++;
    if (rotationNum == 4) {
        rotationNum = 0;
    }
    // Toggle visible layers within instance
    tetrimoGroup().children.forEach(child => {
        if (child.name == rotationNum.toString()) {
            visibleTetrimoGroup = child;
            visibleTetrimoGroup.visible = true;
        }
        else {
            child.visible = false;
        }
    });
    // Push inwards if rotating will cause out of bounds
    const unitChildren = visibleTetrimoGroup.children;
    let minX = 0;
    let maxX = 9;
    for (let i = 0; i < unitChildren.length; i++) {
        const unitChild = unitChildren[i];
        const { x } = unitBoardCoordinates(unitChild);
        minX = Math.min(x, minX);
        maxX = Math.max(x, maxX);
    }
    if (minX < 0) {
        moveCurrentTetrimoX(-1 * minX);
    }
    else if (maxX > 9) {
        moveCurrentTetrimoX(9 - maxX);
    }
};
const hold = () => {
    if (!HOLD || hasHeld) {
        return;
    }
    const heldPiece = HOLD.findChild(() => true);
    // Add curent piece to hold
    const currentPiece = tetrimoGroup();
    currentPiece.x = 0;
    currentPiece.y = UNIT / 2;
    currentPiece.resize(currentPiece.width * 0.6, currentPiece.height * 0.6);
    HOLD.appendChild(currentPiece);
    if (!heldPiece) {
        visibleTetrimoGroup = null;
        generateCurrentTetrimo();
    }
    else {
        heldPiece.x = BOARD.width / 2;
        heldPiece.y = 0;
        heldPiece.resize(heldPiece.width * 1.67, heldPiece.height * 1.67);
        BOARD.appendChild(heldPiece);
        visibleTetrimoGroup = heldPiece.findChild(node => node.visible);
    }
    hasHeld = true;
};
const canMoveDown = () => {
    const unitChildren = visibleTetrimoGroup.children;
    if (needNewTetrimo) {
        return false;
    }
    for (let i = 0; i < unitChildren.length; i++) {
        const unitChild = unitChildren[i];
        const { x, y } = unitBoardCoordinates(unitChild);
        // If the coordinate vertically below the current one is filled, then we cannot move down
        if (coordIsFilled({ x, y: y + 1 })) {
            moveToNextPiece();
            return false;
        }
        if (y == 19 - numDeadRows()) {
            moveToNextPiece();
            return false;
        }
    }
    return true;
};
const updateFilledCoords = () => {
    const unitChildren = visibleTetrimoGroup.children;
    unitChildren.forEach(unitChild => {
        addToFilledCoords(unitChild);
        if (_filledCoords[numDeadRows()] && Object.keys(_filledCoords[numDeadRows()]).length > 0) {
            // Game has ended.
            figma.closePlugin();
        }
    });
};
// Checks if there are any full rows and clears them if there are.
// Returns number of rows cleared.
const checkAndClearRow = () => {
    const rowsToClear = {};
    Object.keys(_filledCoords).sort().forEach(y => {
        if (Object.keys(_filledCoords[y]).length === 10) { // Entire row is filled
            rowsToClear[y] = true;
        }
    });
    Object.keys(rowsToClear).forEach(y => {
        Object.keys(_filledCoords[y]).forEach(x => {
            _filledCoords[y][x].remove();
        });
        delete _filledCoords[y]; // Delete the cleared row in our model
    });
    // Shift the colors as necessary
    let yDiff = 0;
    for (let y = 19; y > 0; y--) {
        if (y in rowsToClear) {
            yDiff += 1;
        }
        else if (y in _filledCoords) {
            const rowToMove = _filledCoords[y];
            _filledCoords[y] = [];
            _filledCoords[y + yDiff] = rowToMove; // Move it down
            Object.keys(rowToMove).forEach(x => {
                rowToMove[x].y += (yDiff * UNIT);
            });
        }
    }
    const numRowsCleared = Object.keys(rowsToClear).length;
    if (numRowsCleared) {
        updateScore(numRowsCleared);
        combo += 1;
    }
    else {
        combo = 0;
    }
    return numRowsCleared;
};
const numClearedToNumSent = (n) => {
    let base = 0;
    if (combo > 10) {
        base = 5;
    }
    else if (combo > 7) {
        base = 4;
    }
    else if (combo > 5) {
        base = 3;
    }
    else if (combo > 3) {
        base = 2;
    }
    else if (combo > 2) {
        base = 1;
    }
    if (n <= 1) {
        return base;
    }
    if (n < 3) {
        return base + n - 1;
    }
    if (n == 4) {
        return base + 4;
    }
};
const updateScore = (clearedRows) => {
    if (!clearedRows) {
        return;
    }
    switch (clearedRows) {
        case 1:
            score += 40;
            break;
        case 2:
            score += 100;
            break;
        case 3:
            score += 300;
            break;
        case 4:
            score += 400;
            break;
    }
    figma.ui.postMessage(score);
};
const moveToNextPiece = () => {
    visibleTetrimoGroup && updateFilledCoords();
    const numClearedRows = checkAndClearRow();
    updateMultiplayerGarbageLines(numClearedRows);
    generateCurrentTetrimo();
    hasHeld = false;
};
const updateMultiplayerGarbageLines = (numClearedRows) => {
    if (!multiplayer)
        return;
    if (numClearedRows) {
        let numRowsToSend = numClearedToNumSent(numClearedRows);
        if (numPendingDeadRows()) {
            numRowsToSend -= numPendingDeadRows();
            setNumPendingDeadRows(Math.max(-1 * numRowsToSend, 0));
        }
        const deadRows = numDeadRows();
        if (numRowsToSend > 0 && deadRows) {
            removeDeadRows(numRowsToSend);
            numRowsToSend -= deadRows;
        }
        if (numRowsToSend > 0) {
            sendPendingDeadRowsToOpponent(numRowsToSend);
        }
    }
    else {
        addDeadRowsFromQueue();
    }
};
// Code for one clock tick of the game.
// Repeating this function is handled by a setInterval method in message handler.
const play = () => {
    if (needNewTetrimo) {
        moveToNextPiece();
    }
    // Move down if there are no other operations currently happening
    moveCurrentTetrimoY(1);
};
