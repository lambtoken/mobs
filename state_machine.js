export default class StateMachine {
    constructor(parent) {
        this.parent = parent
        this.states = {}
        this.currentState = null
    }

    addState(name, state) {
        this.states[name] = state
        state.name = name
        state.stateMachine = this
    }

    changeState(name) {

        if (!this.states[name]) {
            console.error(`State '${name}' does not exist!`)
            return
        }

        if (this.currentState == name) {
            return
        }

        if (this.currentState?.exit) {
            this.currentState.exit(this)
        }

        this.currentState = this.states[name]
        
        if (this.currentState?.enter) {
            this.currentState.enter(this)
        }
    }

    update(dt) {
        if (this.currentState?.update) {
            this.currentState.update(this, dt)
        }
    }

    draw() {
        if (this.currentState?.draw) {
            this.currentState.draw(this)
        }
    }
}