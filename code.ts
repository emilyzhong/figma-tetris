figma.showUI(__html__, {height: 310, width: 350});

figma.ui.onmessage = msg => {
  console.log("")
  switch (msg.type) {
    case 'start':
      if (!gameFunction) {
        gameFunction = setInterval(play, CLOCK_TICK)
      }
      break
    case 'reset':
      resetGame()
      break
    case 'move-left':
      moveCurrentTetrimoX(-1)
      break
    case 'move-right':
      moveCurrentTetrimoX(1)
      break
    case 'soft-drop':
      moveCurrentTetrimoY(1)
      break
    case 'hard-drop':
      hardDrop()
      break
    case 'rotate':
      rotate()
      break
    case 'hold':
      hold()
      break
  }
}

const playPage = figma.root.findChild(node => node.name === 'Play')
if (!playPage) {
  figma.closePlugin()
} else {
 figma.currentPage = playPage
 figma.root.setRelaunchData({ play: ''})
}

const UNIT = 60
const CLOCK_TICK = 800
// Array of tetrimo components to choose from
const TETRIMO_COMPONENTS: Array<ComponentNode> = <Array<ComponentNode>>figma.root.findAll(node => {
  return node.type === 'COMPONENT' && node.name.length === 1
})
const BOARD: FrameNode = figma.currentPage.findOne(node => node.name === "Board" && node.type === 'FRAME') as FrameNode
const NEXT_PIECE: FrameNode = figma.currentPage.findOne(node => node.name === "Next Piece") as FrameNode
const HOLD: FrameNode = figma.currentPage.findOne(node => node.name === "Hold") as FrameNode

// Figma sets the (x, y) attributes of a shape to the upper left corner.
// Y increases as it goes downwards, X increases to the right.
// These coordiantes are the "solid" areas of each tetrimo type,
// relative to the upper-left (x, y)
const TUP = (x: number, y: number) => { return {x, y}} // Helper function
const asUnits = (n) => Math.round(n / UNIT)

let gameFunction
let visibleTetrimoGroup: SceneNode & ChildrenMixin 
let rotationNum = 0
let needNewTetrimo = true
let score = 0

function clone(val) {
  const type = typeof val
  if (val === null) {
    return null
  } else if (type === 'undefined' || type === 'number' ||
             type === 'string' || type === 'boolean') {
    return val
  } else if (type === 'object') {
    if (val instanceof Array) {
      return val.map(x => clone(x))
    } else if (val instanceof Uint8Array) {
      return new Uint8Array(val)
    } else {
      let o = {}
      for (const key in val) {
        o[key] = clone(val[key])
      }
      return o
    }
  }
  throw 'unknown'
}

// This stores which coordinates of the board are filled.
// It is first indexed on y, then x, then a rectangle node that will sit at that location.
let _filledCoords: { [yCoord: number]: { [xCoord: number]: RectangleNode } } = {}

const addToFilledCoords = (unitNode: RectangleNode) => {
  const {x, y} = unitBoardCoordinates(unitNode)
  if (!_filledCoords[y]) { _filledCoords[y] = {}}
  const newRectangle = figma.createRectangle()
  newRectangle.resize(60, 60)
  newRectangle.fills = clone(unitNode.fills)
  newRectangle.x = x * UNIT
  newRectangle.y = y * UNIT

  BOARD.appendChild(newRectangle)
  _filledCoords[y][x] = newRectangle
}

const coordIsFilled = (coord: {x: number, y: number}): boolean => {
  const {x ,y} = coord
  return !!(_filledCoords[y] && _filledCoords[y][x])
}

const tetrimoGroup = (): SceneNode & ChildrenMixin => {
  return visibleTetrimoGroup.parent as SceneNode & ChildrenMixin
}

// Given one unit node, return its coordinates on the tetris board
const unitBoardCoordinates = (unitNode: SceneNode) => {
  const tetrimoParent = tetrimoGroup()
  const x = unitNode.x + tetrimoParent.x
  const y = unitNode.y + tetrimoParent.y

  return TUP(asUnits(x), asUnits(y))
}

const resetGame = () => {
  clearInterval(gameFunction)
  gameFunction = null
  BOARD.children.forEach(child => child.remove())
  NEXT_PIECE?.children?.forEach(child => child.remove())
  HOLD?.children?.forEach(child => child.remove())
  score = 0
  needNewTetrimo = true
  rotationNum = 0
  visibleTetrimoGroup = null
  _filledCoords = {}
  figma.ui.postMessage(0)
}

const generateCurrentTetrimo = () => {
  // Remove previous tetrimo
  if (visibleTetrimoGroup) {
    visibleTetrimoGroup.parent.remove()
  }

  const index = Math.floor(Math.random() * TETRIMO_COMPONENTS.length)
  const tetrimo = TETRIMO_COMPONENTS[index]
  let tetrimoGroup = tetrimo.createInstance()

  rotationNum = 1
  tetrimoGroup.children.forEach(child => {
    if (child.name == rotationNum.toString()) {
      child.visible = true
    } else {
      child.visible = false
    }
  })

  // If we are supporting seeing the next piece, set the existing next piece as the new current piece,
  // and set the newly generated piece as the new next piece
  if (NEXT_PIECE) {
    const nextTetrimoGroup = tetrimoGroup
    nextTetrimoGroup.resize(nextTetrimoGroup.width * .6, nextTetrimoGroup.height * .6)
    tetrimoGroup = NEXT_PIECE.findChild(() => true) as InstanceNode // There should only be one thing piece
    NEXT_PIECE.appendChild(nextTetrimoGroup)
    nextTetrimoGroup.y = UNIT / 2

    if (!tetrimoGroup) { 
      // The first time this gets run, tetrimoGroup will be null because there is nothing in next piece
      // Thus, we will call use this first call as filling "next piece", then short-circuit and call
      // generateCurrentTetrimo to fill both the current piece and the next piece.
      generateCurrentTetrimo()
      return
    }
    
    tetrimoGroup?.resize(tetrimoGroup.width * 1.67, tetrimoGroup.height * 1.67)
  }

  tetrimoGroup.x = BOARD.width / 2
  tetrimoGroup.y = 0
  BOARD.appendChild(tetrimoGroup)
  visibleTetrimoGroup = tetrimoGroup.findChild(child => child.visible) as SceneNode & ChildrenMixin

  needNewTetrimo = false
}

const moveCurrentTetrimoX = (x: number) => {
  if (!visibleTetrimoGroup) { return }

  // Check if can move left/right first
  const unitChildren = visibleTetrimoGroup.children
  for (let i = 0; i < unitChildren.length; i++) {
    const child = unitChildren[i]
    const {x: currX, y} = unitBoardCoordinates(child)
    // If this will push us out of bounds
    if ((currX + x) < 0 || (currX + x) >= 10) {
      return
    }
    // If this will push us into a filled spot
    if (coordIsFilled({x: currX + x, y})) {
      return
    }
  }

  // If ok, then move
  tetrimoGroup().x += (UNIT * x)
}

const moveCurrentTetrimoY = (y: number) => {
  if (!visibleTetrimoGroup) {
    return
  }

  if (canMoveDown()) {
    tetrimoGroup().y += (UNIT * y)
  } 
}

// Very hacky lol
const hardDrop = () => {
  while (canMoveDown()) {
    moveCurrentTetrimoY(1)
  }
}

const rotate = () => {
  rotationNum++
  if (rotationNum == 4) {
    rotationNum = 0
  }

  // Toggle visible layers within instance 
  tetrimoGroup().children.forEach(child => {
    if (child.name == rotationNum.toString()) {
      visibleTetrimoGroup = child as SceneNode & ChildrenMixin
      visibleTetrimoGroup.visible = true
    } else {
      child.visible = false
    }
  })

  // Push inwards if rotating will cause out of bounds
  const unitChildren = visibleTetrimoGroup.children

  let minX = 0
  let maxX = 9
  for (let i = 0; i < unitChildren.length; i++) {
    const unitChild = unitChildren[i]
    const { x } = unitBoardCoordinates(unitChild)
    minX = Math.min(x, minX)
    maxX = Math.max(x, maxX)
  }
  if (minX < 0) {
    moveCurrentTetrimoX(-1 * minX)
  } else if (maxX > 9) {
    moveCurrentTetrimoX(9 - maxX)
  }
}

const hold = () => {
  if (!HOLD) { return }
  const heldPiece = HOLD.findChild(() => true) as SceneNode & ChildrenMixin 
  // Add curent piece to hold
  const currentPiece = tetrimoGroup() 
  currentPiece.x = 0
  currentPiece.y = UNIT / 2
  currentPiece.resize(currentPiece.width * 0.6, currentPiece.height * 0.6)
  HOLD.appendChild(currentPiece)

  if (!heldPiece) {
    visibleTetrimoGroup = null
    generateCurrentTetrimo()
  } else {
    heldPiece.x = BOARD.width / 2
    heldPiece.y = 0
    heldPiece.resize(heldPiece.width * 1.67, heldPiece.height * 1.67)
    BOARD.appendChild(heldPiece)
    visibleTetrimoGroup = heldPiece.findChild(node => node.visible) as SceneNode & ChildrenMixin 
  }
}

const canMoveDown = (): boolean => {
  const unitChildren = visibleTetrimoGroup.children
  if (needNewTetrimo) { return false }

  for (let i = 0; i < unitChildren.length; i++) {
    const unitChild = unitChildren[i]
    const {x, y} = unitBoardCoordinates(unitChild)

    // If the coordinate vertically below the current one is filled, then we cannot move down
    if (coordIsFilled({x, y: y+1})) {
      needNewTetrimo = true
      return false
    }
    if (y == 19) {
      needNewTetrimo = true
      return false
    }
  }
  return true
}

const updateFilledCoords = () => {
  const unitChildren = visibleTetrimoGroup.children
 
  unitChildren.forEach(unitChild => {
    addToFilledCoords(unitChild as RectangleNode)
   
    if (_filledCoords[0]) {
      // Game has ended.
      figma.closePlugin()
    }
  })
}

const checkAndClearRow = () => {
  const rowsToClear:{[y: number]: true} = {}
  Object.keys(_filledCoords).sort().forEach(y => {
    if (Object.keys(_filledCoords[y]).length === 10) { // Entire row is filled
      rowsToClear[y] = true
    }
  })

  Object.keys(rowsToClear).forEach(y => {
    Object.keys(_filledCoords[y]).forEach(x => {
      _filledCoords[y][x].remove()
    })
    delete _filledCoords[y] // Delete the cleared row in our model
  })

  // Shift the colors as necessary
  let yDiff = 0
  for (let y = 19; y > 0; y--) {
    if (y in rowsToClear) {
      yDiff += 1
    } else if (y in _filledCoords) {
      const rowToMove = _filledCoords[y]
      _filledCoords[y] = []
      _filledCoords[y + yDiff] = rowToMove // Move it down
      Object.keys(rowToMove).forEach(x => {
        rowToMove[x].y += (yDiff * UNIT)
      })
    }
  }

  if (rowsToClear) {
    updateScore(Object.keys(rowsToClear).length)
  }
}

const updateScore = (clearedRows: number) => {
  if (!clearedRows) { return }
  switch (clearedRows) {
    case 1:
      score += 40
      break
    case 2:
      score += 100
      break
    case 3:
      score += 300
      break
    case 4:
      score += 400
      break
  }
  figma.ui.postMessage(score)
}

// Code for one clock tick of the game.
// Repeating this function is handled by a setInterval method in message handler.
const play = () => {
  if (needNewTetrimo) {
    visibleTetrimoGroup && updateFilledCoords()
    checkAndClearRow()
    generateCurrentTetrimo()
    return
  }

  // Move down if there are no other operations currently happening
  moveCurrentTetrimoY(1)
}